import type { Request } from 'express';
import type { AppAbility } from '../authorization/ability.factory.js';
import type { Role } from '../database/schema/index.js';

export interface AuthUser {
  id: string;
  role: Role;
}

export interface AuthenticatedRequest extends Request {
  user: AuthUser;
  ability?: AppAbility;
}
