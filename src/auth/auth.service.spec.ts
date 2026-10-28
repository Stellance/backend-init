import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash } from '@node-rs/argon2';
import { createHash } from 'node:crypto';
import { configStub } from '../../test/fake-context.js';
import type { Database } from '../database/database.js';
import type { Mailer } from '../mail/mailer.js';
import { AuthService } from './auth.service.js';
import type { SessionRevocationService } from './session-revocation.service.js';
import * as authQueries from './auth.queries.js';
import * as usersQueries from '../users/users.queries.js';

vi.mock('./auth.queries.js');
vi.mock('../users/users.queries.js');
vi.mock('../audit/audit.queries.js', () => ({ recordAudit: vi.fn() }));

const q = vi.mocked(authQueries);
const u = vi.mocked(usersQueries);
const sha = (v: string) => createHash('sha256').update(v).digest('hex');

const user = {
  id: 'u1',
  email: 'a@b.test',
  passwordHash: '',
  role: 'user' as const,
  createdAt: new Date(),
};

const setup = () => {
  const revoke = vi.fn().mockResolvedValue(undefined as never);
  const tryRevoke = vi.fn().mockResolvedValue(undefined as never);
  const send = vi.fn().mockResolvedValue(undefined as never);
  const database = {
    db: {},
    transaction: (fn: (tx: object) => unknown) => fn({}),
  } as unknown as Database;
  const service = new AuthService(
    database,
    new JwtService({ secret: 'k'.repeat(40) }),
    { revoke, tryRevoke } as unknown as SessionRevocationService,
    { send } as unknown as Mailer,
    configStub({
      ACCESS_TOKEN_TTL_SECONDS: 900,
      REFRESH_TOKEN_TTL_DAYS: 30,
      PUBLIC_WEB_URL: 'https://app.test/',
    }),
  );
  return { service, revoke, tryRevoke, send };
};

const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  vi.resetAllMocks();
  q.insertRefreshToken.mockResolvedValue(undefined as never);
  q.upsertOneTimeToken.mockResolvedValue(true);
  q.markEmailVerified.mockResolvedValue(undefined as never);
});

describe('AuthService.login', () => {
  it('rejects an unknown email with the same error as a wrong password', async () => {
    const { service } = setup();
    u.findUserByEmail.mockResolvedValue(undefined);
    await expect(
      service.login({ email: 'x@y.test', password: 'whatever-whatever' }),
    ).rejects.toThrow(new UnauthorizedException('Invalid credentials'));

    u.findUserByEmail.mockResolvedValue({
      ...user,
      passwordHash: await hash('right-password-123'),
    });
    await expect(
      service.login({ email: user.email, password: 'wrong-password-123' }),
    ).rejects.toThrow(new UnauthorizedException('Invalid credentials'));
  });

  it('issues a token pair whose access token carries the family as sid', async () => {
    const { service } = setup();
    const withHash = {
      ...user,
      passwordHash: await hash('right-password-123'),
    };
    u.findUserByEmail.mockResolvedValue(withHash);
    u.findUserById.mockResolvedValue(withHash);
    const tokens = await service.login({
      email: user.email,
      password: 'right-password-123',
    });
    const claims = new JwtService().decode<{ sid: string; sub: string }>(
      tokens.accessToken,
    );
    expect(claims.sub).toBe('u1');
    expect(q.insertRefreshToken.mock.calls[0][1].familyId).toBe(claims.sid);
    expect(tokens.expiresIn).toBe(900);
  });
});

describe('AuthService.login races', () => {
  it('rejects a login whose password changed while it was being verified', async () => {
    const { service } = setup();
    const verified = {
      ...user,
      passwordHash: await hash('right-password-123'),
    };
    u.findUserByEmail.mockResolvedValue(verified);
    u.findUserById.mockResolvedValue({ ...verified, passwordHash: 'reset' });
    await expect(
      service.login({ email: user.email, password: 'right-password-123' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(q.insertRefreshToken).not.toHaveBeenCalled();
  });
});

describe('AuthService.refresh', () => {
  const row = {
    tokenHash: 'h',
    familyId: 'fam',
    userId: 'u1',
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
  };

  it('locks the user before consuming the token', async () => {
    const { service } = setup();
    const order: string[] = [];
    q.findRefreshToken.mockResolvedValue(row);
    u.lockUser.mockImplementation((() => {
      order.push('lock');
    }) as never);
    q.consumeRefreshToken.mockImplementation((async () => {
      order.push('consume');
      return row;
    }) as never);
    u.findUserById.mockResolvedValue(user);
    await service.refresh('tok');
    expect(order).toEqual(['lock', 'consume']);
    expect(q.markRefreshTokenUsed).toHaveBeenCalled();
  });

  it('revokes the family and sessions when a used token is replayed', async () => {
    const { service, tryRevoke } = setup();
    q.findRefreshToken.mockResolvedValue(undefined as never);
    q.consumeRefreshToken.mockResolvedValue(undefined as never);
    q.findUsedRefreshToken.mockResolvedValue({
      tokenHash: 'h',
      familyId: 'fam',
      usedAt: new Date(),
    });
    await expect(service.refresh('tok')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(q.deleteFamily).toHaveBeenCalledWith(expect.anything(), 'fam');
    expect(tryRevoke).toHaveBeenCalledWith(['fam']);
  });

  it('rejects unknown and expired tokens without issuing anything', async () => {
    const { service } = setup();
    q.findRefreshToken.mockResolvedValue(undefined as never);
    q.consumeRefreshToken.mockResolvedValue(undefined as never);
    q.findUsedRefreshToken.mockResolvedValue(undefined as never);
    await expect(service.refresh('tok')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    q.consumeRefreshToken.mockResolvedValue({
      ...row,
      expiresAt: new Date(Date.now() - 1),
    });
    await expect(service.refresh('tok')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(q.insertRefreshToken).not.toHaveBeenCalled();
  });
});

describe('AuthService logout', () => {
  it('logout revokes the access tokens of that family', async () => {
    const { service, tryRevoke } = setup();
    q.consumeRefreshToken.mockResolvedValue({
      tokenHash: 'h',
      familyId: 'fam',
      userId: 'u1',
      expiresAt: new Date(),
      createdAt: new Date(),
    });
    await service.logout('tok');
    expect(tryRevoke).toHaveBeenCalledWith(['fam']);
  });

  it('logout with a token a racing refresh already rotated still ends the family', async () => {
    const { service, tryRevoke } = setup();
    q.findRefreshToken.mockResolvedValue(undefined as never);
    q.consumeRefreshToken.mockResolvedValue(undefined as never);
    q.findUsedRefreshToken.mockResolvedValue({
      tokenHash: 'h',
      familyId: 'fam',
      usedAt: new Date(),
    });
    await service.logout('tok');
    expect(q.deleteFamily).toHaveBeenCalledWith(expect.anything(), 'fam');
    expect(tryRevoke).toHaveBeenCalledWith(['fam']);
  });

  it('logoutAll fails (and so rolls back) when revocation fails', async () => {
    const { service, revoke } = setup();
    q.deleteAllForUser.mockResolvedValue(['f1']);
    revoke.mockRejectedValue(new Error('redis down'));
    await expect(service.logoutAll('u1')).rejects.toThrow('redis down');
  });

  it('logout of an unknown token is a no-op', async () => {
    const { service, tryRevoke } = setup();
    q.findRefreshToken.mockResolvedValue(undefined as never);
    q.consumeRefreshToken.mockResolvedValue(undefined as never);
    q.findUsedRefreshToken.mockResolvedValue(undefined as never);
    await service.logout('tok');
    expect(tryRevoke).not.toHaveBeenCalled();
  });

  it('logoutAll revokes every family after locking the user', async () => {
    const { service, revoke } = setup();
    q.deleteAllForUser.mockResolvedValue(['f1', 'f2']);
    await service.logoutAll('u1');
    expect(u.lockUser).toHaveBeenCalledWith(expect.anything(), 'u1');
    expect(revoke).toHaveBeenCalledWith(['f1', 'f2']);
  });
});

describe('AuthService password reset', () => {
  it('requestPasswordReset mails a link only when the account exists', async () => {
    const { service, send } = setup();
    u.findUserByEmail.mockResolvedValue(undefined);
    service.requestPasswordReset('none@x.test');
    await flush();
    expect(send).not.toHaveBeenCalled();

    u.findUserByEmail.mockResolvedValue(user);
    service.requestPasswordReset(user.email);
    await flush();
    expect(send).toHaveBeenCalledOnce();
    const { to, text } = send.mock.calls[0][0] as { to: string; text: string };
    expect(to).toBe(user.email);
    const token = /token=(\S+)/.exec(text)![1];
    expect(text).toContain('https://app.test/reset-password?token=');
    expect(q.upsertOneTimeToken.mock.calls[0][1]).toMatchObject({
      userId: 'u1',
      purpose: 'reset_password',
      tokenHash: sha(token),
    });
  });

  it('requestPasswordReset sends nothing while the pending token is in cooldown', async () => {
    const { service, send } = setup();
    u.findUserByEmail.mockResolvedValue(user);
    q.upsertOneTimeToken.mockResolvedValue(false);
    service.requestPasswordReset(user.email);
    await flush();
    expect(send).not.toHaveBeenCalled();
  });

  it('requestPasswordReset never throws when mail fails', async () => {
    const { service, send } = setup();
    u.findUserByEmail.mockResolvedValue(user);
    send.mockRejectedValue(new Error('smtp down'));
    expect(() => service.requestPasswordReset(user.email)).not.toThrow();
    await flush();
  });

  it('resetPassword sets the hash, ends all sessions and verifies the email', async () => {
    const { service, revoke } = setup();
    q.consumeOneTimeToken.mockResolvedValue({
      userId: 'u1',
      purpose: 'reset_password',
      tokenHash: 'h',
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    });
    q.deleteAllForUser.mockResolvedValue(['f1']);
    await service.resetPassword('t'.repeat(30), 'new-password-123');
    expect(u.updatePasswordHash).toHaveBeenCalledWith(
      expect.anything(),
      'u1',
      expect.stringMatching(/^\$argon2/),
    );
    expect(q.markEmailVerified).toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith(['f1']);
  });

  it.each([
    ['unknown', undefined],
    ['expired', { userId: 'u1', expiresAt: new Date(Date.now() - 1) }],
  ])(
    'resetPassword rejects an %s token and changes nothing',
    async (_n, row) => {
      const { service, revoke } = setup();
      q.consumeOneTimeToken.mockResolvedValue(row as never);
      await expect(
        service.resetPassword('t'.repeat(30), 'new-password-123'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(u.updatePasswordHash).not.toHaveBeenCalled();
      expect(revoke).not.toHaveBeenCalled();
    },
  );
});

describe('AuthService email verification', () => {
  it('verifyEmail marks the user verified; bad token is 400', async () => {
    const { service } = setup();
    q.consumeOneTimeToken.mockResolvedValue({
      userId: 'u1',
      expiresAt: new Date(Date.now() + 60_000),
    } as never);
    await service.verifyEmail('t'.repeat(30));
    expect(q.markEmailVerified).toHaveBeenCalledWith(expect.anything(), 'u1');

    q.consumeOneTimeToken.mockResolvedValue(undefined as never);
    await expect(service.verifyEmail('t'.repeat(30))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('resendVerification skips already-verified users', async () => {
    const { service, send } = setup();
    u.findUserById.mockResolvedValue(user);
    q.isEmailVerified.mockResolvedValue(true);
    await service.resendVerification('u1');
    await flush();
    expect(send).not.toHaveBeenCalled();

    q.isEmailVerified.mockResolvedValue(false);
    await service.resendVerification('u1');
    await flush();
    expect(send).toHaveBeenCalledOnce();
  });

  it('me reports emailVerified', async () => {
    const { service } = setup();
    u.findUserById.mockResolvedValue(user);
    q.isEmailVerified.mockResolvedValue(true);
    expect(await service.me('u1')).toMatchObject({ emailVerified: true });
  });
});
