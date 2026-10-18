import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import { Database } from '../database/database.js';
import { REDIS } from '../redis/redis.module.js';

// Protected by the global JwtAuthGuard: no @Public().
@ApiBearerAuth()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicators: HealthIndicatorService,
    private readonly database: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @HealthCheck()
  @Get()
  check() {
    return this.health.check([
      () => this.probe('database', () => this.database.ping()),
      () => this.probe('redis', () => this.redis.ping()),
    ]);
  }

  private async probe(
    key: string,
    fn: () => Promise<unknown>,
  ): Promise<HealthIndicatorResult> {
    const session = this.indicators.check(key);
    try {
      await fn();
      return session.up();
    } catch {
      return session.down();
    }
  }
}
