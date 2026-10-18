import {
  createMongoAbility,
  type MongoAbility,
  type RawRuleOf,
} from '@casl/ability';
import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user.js';

export type Action = 'manage' | 'create' | 'read' | 'update' | 'delete';
export type Subject = 'User' | 'AuditLog' | 'all';
export type AppAbility = MongoAbility<[Action, Subject]>;

@Injectable()
export class AbilityFactory {
  forUser(user: AuthUser): AppAbility {
    const rules: RawRuleOf<AppAbility>[] = [];
    if (user.role === 'admin') {
      rules.push({ action: 'manage', subject: 'all' });
    } else {
      rules.push({
        action: ['read', 'update'],
        subject: 'User',
        conditions: { id: user.id },
      });
    }
    return createMongoAbility<AppAbility>(rules);
  }
}
