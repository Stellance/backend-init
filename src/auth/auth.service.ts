import { v7 } from 'uuid';
import { createHash, randomBytes } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from '@node-rs/argon2';
import { recordAudit } from '../audit/audit.queries.js';
import type { EnvVars } from '../config/env.validation.js';
import { Database, type Tx } from '../database/database.js';
import {
  findUserByEmail,
  findUserById,
  insertUser,
} from '../users/users.queries.js';
import {
  consumeRefreshToken,
  deleteExpiredForUser,
  deleteFamily,
  findUsedRefreshToken,
  insertRefreshToken,
  markRefreshTokenUsed,
} from './auth.queries.js';
import type {
  AuthTokensDto,
  LoginDto,
  MeDto,
  RegisterDto,
} from './dto/auth.dto.js';
import type { Role } from '../database/schema/index.js';

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

type RefreshOutcome =
  | { kind: 'ok'; tokens: AuthTokensDto }
  | { kind: 'invalid' }
  | { kind: 'reuse' };

@Injectable()
export class AuthService {
  private readonly accessTtlSeconds: number;
  private readonly refreshTtlMs: number;
  // Verified against when the email is unknown, to keep timing uniform.
  private readonly dummyHash: Promise<string>;

  constructor(
    private readonly database: Database,
    private readonly jwt: JwtService,
    config: ConfigService<EnvVars, true>,
  ) {
    this.accessTtlSeconds = config.get('ACCESS_TOKEN_TTL_SECONDS', {
      infer: true,
    });
    this.refreshTtlMs =
      config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 86_400_000;
    this.dummyHash = hash(randomBytes(16).toString('hex'));
  }

  async register(dto: RegisterDto): Promise<AuthTokensDto> {
    const passwordHash = await hash(dto.password);
    return this.database.transaction(async (tx) => {
      const user = await insertUser(tx, { email: dto.email, passwordHash });
      await recordAudit(tx, {
        action: 'auth.register',
        actorId: user.id,
        resourceType: 'user',
        resourceId: user.id,
      });
      return this.issueTokens(tx, user.id, user.role, v7());
    });
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
      const row = await consumeRefreshToken(tx, tokenHash);
      if (!row) return;
      await deleteFamily(tx, row.familyId);
      await recordAudit(tx, { action: 'auth.logout', actorId: row.userId });
    });
  }

  async me(userId: string): Promise<MeDto> {
    const user = await findUserById(this.database.db, userId);
    if (!user) throw new UnauthorizedException();
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    };
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
    const accessToken = await this.jwt.signAsync({ sub: userId, role });
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.accessTtlSeconds,
    };
  }
}
