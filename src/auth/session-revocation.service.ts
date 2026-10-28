import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { EnvVars } from '../config/env.validation.js';
import { REDIS } from '../redis/redis.module.js';

const key = (sessionId: string) => `revoked:sid:${sessionId}`;
// Covers the access-token lifetime plus clock skew; after that the JWT is dead anyway.
const SKEW_SECONDS = 60;

/**
 * Denylist of session ids whose access tokens must stop working before they
 * expire. Fails open on Redis errors, like the rate limiter.
 */
@Injectable()
export class SessionRevocationService {
  private readonly logger = new Logger(SessionRevocationService.name);
  private readonly ttlSeconds: number;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    config: ConfigService<EnvVars, true>,
  ) {
    this.ttlSeconds =
      config.get('ACCESS_TOKEN_TTL_SECONDS', { infer: true }) + SKEW_SECONDS;
  }

  /** Throws on Redis failure: callers that must not report success without it. */
  async revoke(sessionIds: readonly string[]): Promise<void> {
    if (sessionIds.length === 0) return;
    const pipeline = this.redis.pipeline();
    for (const id of sessionIds) {
      pipeline.set(key(id), '1', 'EX', this.ttlSeconds);
    }
    const results = (await pipeline.exec()) ?? [];
    const failed = results.find(([err]) => err);
    if (failed) throw failed[0];
  }

  /** For paths where the DB change already protects the account (single logout, reuse). */
  async tryRevoke(sessionIds: readonly string[]): Promise<void> {
    try {
      await this.revoke(sessionIds);
    } catch (err) {
      this.logger.error(
        { err, count: sessionIds.length },
        'Failed to revoke sessions',
      );
    }
  }

  async isRevoked(sessionId: string): Promise<boolean> {
    try {
      return (await this.redis.exists(key(sessionId))) === 1;
    } catch (err) {
      this.logger.error({ err }, 'Revocation check unavailable, allowing');
      return false;
    }
  }
}
