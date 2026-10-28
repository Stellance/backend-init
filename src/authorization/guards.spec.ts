import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { fakeContext } from '../../test/fake-context.js';
import { AbilityFactory } from './ability.factory.js';
import { PoliciesGuard, RolesGuard } from './guards.js';
import { POLICIES_KEY } from './policies.decorator.js';
import { ROLES_KEY } from './roles.decorator.js';

const handler = function h() {};
const withMeta = (key: string, value: unknown) => {
  Reflect.defineMetadata(key, value, handler);
};

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  it('allows routes without role metadata', () => {
    const { ctx } = fakeContext({}, function none() {});
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows a matching role and rejects others', () => {
    withMeta(ROLES_KEY, ['admin']);
    expect(
      guard.canActivate(
        fakeContext({ user: { id: '1', role: 'admin' } }, handler).ctx,
      ),
    ).toBe(true);
    expect(() =>
      guard.canActivate(
        fakeContext({ user: { id: '1', role: 'user' } }, handler).ctx,
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects when there is no user', () => {
    withMeta(ROLES_KEY, ['admin']);
    expect(() => guard.canActivate(fakeContext({}, handler).ctx)).toThrow(
      ForbiddenException,
    );
  });
});

describe('PoliciesGuard', () => {
  const guard = new PoliciesGuard(new Reflector(), new AbilityFactory());

  it('allows routes without policies', () => {
    expect(guard.canActivate(fakeContext({}, function none() {}).ctx)).toBe(
      true,
    );
  });

  it('attaches the ability and enforces every policy', () => {
    withMeta(POLICIES_KEY, [
      (a: { can: (...x: unknown[]) => boolean }) => a.can('read', 'User'),
    ]);
    const req: Record<string, unknown> = { user: { id: '1', role: 'user' } };
    expect(guard.canActivate(fakeContext(req, handler).ctx)).toBe(true);
    expect(req.ability).toBeDefined();

    withMeta(POLICIES_KEY, [
      (a: { can: (...x: unknown[]) => boolean }) => a.can('delete', 'User'),
    ]);
    expect(() =>
      guard.canActivate(
        fakeContext({ user: { id: '1', role: 'user' } }, handler).ctx,
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects when there is no user', () => {
    withMeta(POLICIES_KEY, [() => true]);
    expect(() => guard.canActivate(fakeContext({}, handler).ctx)).toThrow(
      ForbiddenException,
    );
  });
});
