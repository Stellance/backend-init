import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { configStub, fakeContext } from '../../test/fake-context.js';
import { IS_PUBLIC_KEY } from './decorators.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import type { SessionRevocationService } from './session-revocation.service.js';

const SECRET = 'unit-secret-unit-secret-unit-secret-1';
const ISSUER = 'unit';
const jwt = new JwtService({
  secret: SECRET,
  signOptions: { algorithm: 'HS256', issuer: ISSUER, expiresIn: 60 },
});

const build = (revoked = false) =>
  new JwtAuthGuard(
    jwt,
    new Reflector(),
    { isRevoked: async () => revoked } as unknown as SessionRevocationService,
    configStub({ JWT_ACCESS_SECRET: SECRET, APP_NAME: ISSUER }),
  );

const bearer = (token: string) => ({
  headers: { authorization: `Bearer ${token}` },
});
const sign = (payload: object) => jwt.signAsync(payload);

describe('JwtAuthGuard', () => {
  it('lets @Public routes through', async () => {
    const handler = function open() {};
    Reflect.defineMetadata(IS_PUBLIC_KEY, true, handler);
    await expect(
      build().canActivate(fakeContext({ headers: {} }, handler).ctx),
    ).resolves.toBe(true);
  });

  it('attaches the user for a valid token', async () => {
    const req: Record<string, unknown> = bearer(
      await sign({ sub: 'u1', role: 'admin', sid: 's1' }),
    );
    await expect(build().canActivate(fakeContext(req).ctx)).resolves.toBe(true);
    expect(req.user).toEqual({ id: 'u1', role: 'admin' });
  });

  it.each([
    ['no header', {}],
    ['wrong scheme', { authorization: 'Basic abc' }],
    ['garbage token', { authorization: 'Bearer not.a.jwt' }],
  ])('rejects %s', async (_name, headers) => {
    await expect(
      build().canActivate(fakeContext({ headers }).ctx),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects tokens signed with another secret or issuer', async () => {
    const other = new JwtService({ secret: 'x'.repeat(40) });
    const wrongSecret = await other.signAsync(
      { sub: 'u', role: 'user', sid: 's' },
      { issuer: ISSUER },
    );
    const wrongIssuer = await jwt.signAsync(
      { sub: 'u', role: 'user', sid: 's' },
      { issuer: 'evil' },
    );
    for (const t of [wrongSecret, wrongIssuer]) {
      await expect(
        build().canActivate(fakeContext(bearer(t)).ctx),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
  });

  it('rejects payloads missing sid or with an unknown role', async () => {
    for (const p of [
      { sub: 'u', role: 'user' },
      { sub: 'u', role: 'root', sid: 's' },
    ]) {
      await expect(
        build().canActivate(fakeContext(bearer(await sign(p))).ctx),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
  });

  it('rejects a revoked session', async () => {
    const token = await sign({ sub: 'u', role: 'user', sid: 's' });
    await expect(
      build(true).canActivate(fakeContext(bearer(token)).ctx),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
