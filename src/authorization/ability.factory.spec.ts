import { subject } from '@casl/ability';
import { AbilityFactory } from './ability.factory.js';

const factory = new AbilityFactory();

describe('AbilityFactory', () => {
  it('lets admins manage everything', () => {
    const ability = factory.forUser({ id: 'a', role: 'admin' });
    expect(ability.can('delete', 'User')).toBe(true);
    expect(ability.can('read', 'AuditLog')).toBe(true);
  });

  it('limits users to reading and updating themselves', () => {
    const ability = factory.forUser({ id: 'me', role: 'user' });
    expect(ability.can('read', subject('User', { id: 'me' }) as never)).toBe(
      true,
    );
    expect(ability.can('update', subject('User', { id: 'me' }) as never)).toBe(
      true,
    );
    expect(ability.can('read', subject('User', { id: 'other' }) as never)).toBe(
      false,
    );
    expect(ability.can('delete', subject('User', { id: 'me' }) as never)).toBe(
      false,
    );
    expect(ability.can('read', 'AuditLog')).toBe(false);
  });
});
