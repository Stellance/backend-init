import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvVars } from '../config/env.validation.js';
import { Database, type Tx } from '../database/database.js';
import {
  PRUNE_BATCH,
  pruneExpiredOneTimeTokens,
  pruneExpiredRefreshTokens,
  pruneUsedRefreshTokens,
} from './auth.queries.js';

export interface CleanupResult {
  usedRefreshTokens: number;
  refreshTokens: number;
  oneTimeTokens: number;
}

/**
 * Periodic sweep of dead token rows. Safe on every replica: deletes are
 * idempotent and batched so no single statement holds locks for long.
 */
@Injectable()
export class TokenCleanupService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(TokenCleanupService.name);
  private readonly intervalMs: number;
  // A used token only matters while a descendant could still be live.
  private readonly usedRetentionMs: number;
  private timer?: NodeJS.Timeout;
  private sweeping = false;

  constructor(
    private readonly database: Database,
    config: ConfigService<EnvVars, true>,
  ) {
    this.intervalMs =
      config.get('TOKEN_CLEANUP_INTERVAL_MINUTES', { infer: true }) * 60_000;
    this.usedRetentionMs =
      config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 86_400_000;
  }

  onApplicationBootstrap(): void {
    if (this.intervalMs === 0) return;
    this.timer = setInterval(() => void this.sweep(), this.intervalMs);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  async run(now = new Date()): Promise<CleanupResult> {
    const usedBefore = new Date(now.getTime() - this.usedRetentionMs);
    return {
      usedRefreshTokens: await this.drain('used refresh tokens', (tx) =>
        pruneUsedRefreshTokens(tx, usedBefore),
      ),
      refreshTokens: await this.drain('refresh tokens', (tx) =>
        pruneExpiredRefreshTokens(tx, now),
      ),
      oneTimeTokens: await this.drain('one-time tokens', (tx) =>
        pruneExpiredOneTimeTokens(tx, now),
      ),
    };
  }

  /** One failing table must not stop the others from being swept. */
  private async drain(
    label: string,
    batch: (tx: Tx) => Promise<number>,
  ): Promise<number> {
    let total = 0;
    try {
      for (;;) {
        const deleted = await this.database.transaction(batch);
        total += deleted;
        if (deleted < PRUNE_BATCH) break;
      }
    } catch (err) {
      this.logger.error({ err }, `Cleanup of ${label} failed`);
    }
    return total;
  }

  private async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      this.logger.log(await this.run(), 'Token cleanup finished');
    } finally {
      this.sweeping = false;
    }
  }
}
