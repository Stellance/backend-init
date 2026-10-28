import { ForbiddenException } from '@nestjs/common';
import { AbilityFactory } from './ability.factory.js';
import { assertCan } from './assert-can.js';

const ability = new AbilityFactory().forUser({ id: 'me', role: 'user' });

describe('assertCan', () => {
  it('passes when the instance matches the rule conditions', () => {
    expect(() =>
      assertCan(ability, 'read', 'User', { id: 'me' }),
    ).not.toThrow();
  });

  it('throws Forbidden for another instance', () => {
    expect(() => assertCan(ability, 'read', 'User', { id: 'x' })).toThrow(
      ForbiddenException,
    );
  });

  it('throws Forbidden when no ability was built', () => {
    expect(() => assertCan(undefined, 'read', 'User', { id: 'me' })).toThrow(
      ForbiddenException,
    );
  });
});
