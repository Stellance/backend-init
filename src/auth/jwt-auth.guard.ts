import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { EnvVars } from '../config/env.validation.js';
import { getRequestContext } from '../common/request-context.js';
import { type Role, roleEnum } from '../database/schema/index.js';
import type { AuthenticatedRequest } from './auth-user.js';
import { IS_PUBLIC_KEY } from './decorators.js';

interface AccessTokenPayload {
  sub: string;
  role: Role;
}

const isPayload = (p: unknown): p is AccessTokenPayload =>
  typeof p === 'object' &&
  p !== null &&
  typeof (p as AccessTokenPayload).sub === 'string' &&
  roleEnum.enumValues.includes((p as AccessTokenPayload).role);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly secret: string;

  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    config: ConfigService<EnvVars, true>,
  ) {
    this.secret = config.get('JWT_ACCESS_SECRET', { infer: true });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException();

    let payload: unknown;
    try {
      payload = await this.jwt.verifyAsync(token, {
        secret: this.secret,
        algorithms: ['HS256'],
        issuer: 'blockstage-backend',
      });
    } catch {
      throw new UnauthorizedException();
    }
    if (!isPayload(payload)) throw new UnauthorizedException();

    req.user = { id: payload.sub, role: payload.role };
    const ctx = getRequestContext();
    if (ctx) ctx.userId = payload.sub;
    return true;
  }
}
