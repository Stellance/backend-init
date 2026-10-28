import { v7 } from 'uuid';
import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from '@node-rs/argon2';
import { recordAudit } from '../audit/audit.queries.js';
import type { EnvVars } from '../config/env.validation.js';
import { Database, type Tx } from '../database/database.js';
import { Mailer } from '../mail/mailer.js';
import {
  findUserByEmail,
  findUserById,
  insertUser,
  lockUser,
  updatePasswordHash,
} from '../users/users.queries.js';
import {
  consumeOneTimeToken,
  consumeRefreshToken,
  deleteAllForUser,
  deleteExpiredForUser,
  deleteFamily,
  findOneTimeToken,
  findRefreshToken,
  findUsedRefreshToken,
  insertRefreshToken,
  isEmailVerified,
  markEmailVerified,
  markRefreshTokenUsed,
  upsertOneTimeToken,
} from './auth.queries.js';
import { SessionRevocationService } from './session-revocation.service.js';
import type {
  AuthTokensDto,
  LoginDto,
  MeDto,
  RegisterDto,
} from './dto/auth.dto.js';
import type { OneTimeTokenPurpose, Role } from '../database/schema/index.js';

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

const VERIFY_TTL_MS = 24 * 3_600_000;
const RESET_TTL_MS = 3_600_000;
const REISSUE_COOLDOWN_MS = 60_000;

type RefreshOutcome =
  | { kind: 'ok'; tokens: AuthTokensDto }
  | { kind: 'invalid' }
  | { kind: 'reuse' };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly webUrl: string;
  private readonly accessTtlSeconds: number;
  private readonly refreshTtlMs: number;
  // Verified against when the email is unknown, to keep timing uniform.
  private readonly dummyHash: Promise<string>;

  constructor(
    private readonly database: Database,
    private readonly jwt: JwtService,
    private readonly revocations: SessionRevocationService,
    private readonly mailer: Mailer,
    config: ConfigService<EnvVars, true>,
  ) {
    this.accessTtlSeconds = config.get('ACCESS_TOKEN_TTL_SECONDS', {
      infer: true,
    });
    this.refreshTtlMs =
      config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 86_400_000;
    this.webUrl = config
      .get('PUBLIC_WEB_URL', { infer: true })
      .replace(/\/+$/, '');
    this.dummyHash = hash(randomBytes(16).toString('hex'));
  }

  async register(dto: RegisterDto): Promise<AuthTokensDto> {
    const passwordHash = await hash(dto.password);
    const { user, tokens } = await this.database.transaction(async (tx) => {
      const user = await insertUser(tx, { email: dto.email, passwordHash });
      await recordAudit(tx, {
        action: 'auth.register',
        actorId: user.id,
        resourceType: 'user',
        resourceId: user.id,
      });
      return {
        user,
        tokens: await this.issueTokens(tx, user.id, user.role, v7()),
      };
    });
    this.inBackground('verification email', () =>
      this.sendVerification(user.id, user.email),
    );
    return tokens;
  }

  async login(dto: LoginDto): Promise<AuthTokensDto> {
    const user = await findUserByEmail(this.database.db, dto.email);
    const valid = await verify(
      user?.passwordHash ?? (await this.dummyHash),
      dto.password,
    );
    if (!user || !valid) {
      await this.database.transaction((tx) =>
        recordAudit(tx, {
          action: 'auth.login_failed',
          metadata: { email: dto.email },
        }),
      );
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.database.transaction(async (tx) => {
      await lockUser(tx, user.id);
      // A reset that committed while argon2 ran must not be outlived by this login.
      const current = await findUserById(tx, user.id);
      if (current?.passwordHash !== user.passwordHash) {
        throw new UnauthorizedException('Invalid credentials');
      }
      await deleteExpiredForUser(tx, user.id);
      await recordAudit(tx, { action: 'auth.login', actorId: user.id });
      return this.issueTokens(tx, user.id, user.role, v7());
    });
  }

  async refresh(refreshToken: string): Promise<AuthTokensDto> {
    const tokenHash = sha256(refreshToken);
    // A throw inside the transaction would roll back the family revocation,
    // so the outcome is returned and acted on after commit.
    const outcome = await this.database.transaction(
      async (tx): Promise<RefreshOutcome> => {
        // Lock the user before the token row so reset/logout-all, which take
        // locks in the same order, cannot miss a refresh in flight.
        const peek = await findRefreshToken(tx, tokenHash);
        if (peek) await lockUser(tx, peek.userId);
        const row = await consumeRefreshToken(tx, tokenHash);
        if (!row) {
          const used = await findUsedRefreshToken(tx, tokenHash);
          if (!used) return { kind: 'invalid' };
          await deleteFamily(tx, used.familyId);
          await recordAudit(tx, {
            action: 'auth.refresh_reuse_detected',
            resourceType: 'refresh_token_family',
            resourceId: used.familyId,
          });
          await this.revocations.tryRevoke([used.familyId]);
          return { kind: 'reuse' };
        }
        if (row.expiresAt.getTime() <= Date.now()) return { kind: 'invalid' };

        await markRefreshTokenUsed(tx, {
          tokenHash,
          familyId: row.familyId,
        });
        const user = await findUserById(tx, row.userId);
        if (!user) return { kind: 'invalid' };
        await recordAudit(tx, { action: 'auth.refresh', actorId: row.userId });
        return {
          kind: 'ok',
          tokens: await this.issueTokens(tx, user.id, user.role, row.familyId),
        };
      },
    );
    if (outcome.kind !== 'ok') throw new UnauthorizedException();
    return outcome.tokens;
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = sha256(refreshToken);
    await this.database.transaction(async (tx) => {
      const peek = await findRefreshToken(tx, tokenHash);
      if (peek) await lockUser(tx, peek.userId);
      const row = await consumeRefreshToken(tx, tokenHash);
      // A token rotated away by a racing refresh still names the live family.
      const familyId =
        row?.familyId ?? (await findUsedRefreshToken(tx, tokenHash))?.familyId;
      if (!familyId) return;
      await deleteFamily(tx, familyId);
      await recordAudit(tx, {
        action: 'auth.logout',
        actorId: row?.userId,
        resourceType: 'refresh_token_family',
        resourceId: familyId,
      });
      await this.revocations.tryRevoke([familyId]);
    });
  }

  async logoutAll(userId: string): Promise<void> {
    await this.database.transaction(async (tx) => {
      await lockUser(tx, userId);
      const families = await deleteAllForUser(tx, userId);
      await recordAudit(tx, { action: 'auth.logout_all', actorId: userId });
      await this.revocations.revoke(families);
    });
  }

  /** Always resolves the same way so callers cannot probe which emails exist. */
  requestPasswordReset(email: string): void {
    this.inBackground('password reset email', async () => {
      const user = await findUserByEmail(this.database.db, email);
      if (!user) return;
      const token = await this.issueOneTimeToken(
        user.id,
        'reset_password',
        RESET_TTL_MS,
      );
      if (!token) return;
      await this.mailer.send({
        to: user.email,
        subject: 'Reset your password',
        text: `Use this link within 1 hour to choose a new password:\n${this.webUrl}/reset-password?token=${token}\nIf you did not ask for this, ignore this email.`,
      });
    });
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const tokenHash = sha256(token);
    const passwordHash = await hash(newPassword);
    const ok = await this.database.transaction(async (tx) => {
      const peek = await findOneTimeToken(tx, tokenHash, 'reset_password');
      if (peek) await lockUser(tx, peek.userId);
      const row = await consumeOneTimeToken(tx, tokenHash, 'reset_password');
      if (!row || row.expiresAt.getTime() <= Date.now()) return false;
      await updatePasswordHash(tx, row.userId, passwordHash);
      // Receiving the email proves control of the address.
      await markEmailVerified(tx, row.userId);
      const families = await deleteAllForUser(tx, row.userId);
      await recordAudit(tx, {
        action: 'auth.password_reset',
        actorId: row.userId,
      });
      await this.revocations.revoke(families);
      return true;
    });
    if (!ok) throw new BadRequestException('Invalid or expired token');
  }

  async resendVerification(userId: string): Promise<void> {
    const user = await findUserById(this.database.db, userId);
    if (!user) throw new UnauthorizedException();
    if (await isEmailVerified(this.database.db, userId)) return;
    this.inBackground('verification email', () =>
      this.sendVerification(user.id, user.email),
    );
  }

  async verifyEmail(token: string): Promise<void> {
    const tokenHash = sha256(token);
    const ok = await this.database.transaction(async (tx) => {
      const row = await consumeOneTimeToken(tx, tokenHash, 'verify_email');
      if (!row || row.expiresAt.getTime() <= Date.now()) return false;
      await markEmailVerified(tx, row.userId);
      await recordAudit(tx, {
        action: 'auth.email_verified',
        actorId: row.userId,
      });
      return true;
    });
    if (!ok) throw new BadRequestException('Invalid or expired token');
  }

  async me(userId: string): Promise<MeDto> {
    const user = await findUserById(this.database.db, userId);
    if (!user) throw new UnauthorizedException();
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      emailVerified: await isEmailVerified(this.database.db, user.id),
      createdAt: user.createdAt,
    };
  }

  private async sendVerification(userId: string, email: string): Promise<void> {
    const token = await this.issueOneTimeToken(
      userId,
      'verify_email',
      VERIFY_TTL_MS,
    );
    if (!token) return;
    await this.mailer.send({
      to: email,
      subject: 'Verify your email',
      text: `Confirm your email within 24 hours:\n${this.webUrl}/verify-email?token=${token}`,
    });
  }

  /**
   * Replaces the pending token of the same purpose for this user. Returns
   * undefined while the pending one is younger than the cooldown.
   */
  private async issueOneTimeToken(
    userId: string,
    purpose: OneTimeTokenPurpose,
    ttlMs: number,
  ): Promise<string | undefined> {
    const token = randomBytes(32).toString('base64url');
    const written = await this.database.transaction(async (tx) => {
      const written = await upsertOneTimeToken(
        tx,
        {
          userId,
          purpose,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + ttlMs),
        },
        new Date(Date.now() - REISSUE_COOLDOWN_MS),
      );
      if (written) {
        await recordAudit(tx, {
          action: `auth.${purpose}_token_issued`,
          actorId: userId,
        });
      }
      return written;
    });
    return written ? token : undefined;
  }

  private inBackground(what: string, task: () => Promise<void>): void {
    task().catch((err: unknown) =>
      this.logger.error({ err }, `Failed to send ${what}`),
    );
  }

  private async issueTokens(
    tx: Tx,
    userId: string,
    role: Role,
    familyId: string,
  ): Promise<AuthTokensDto> {
    const refreshToken = randomBytes(32).toString('base64url');
    await insertRefreshToken(tx, {
      tokenHash: sha256(refreshToken),
      familyId,
      userId,
      expiresAt: new Date(Date.now() + this.refreshTtlMs),
    });
    const accessToken = await this.jwt.signAsync({
      sub: userId,
      role,
      sid: familyId,
    });
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.accessTtlSeconds,
    };
  }
}
