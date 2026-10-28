import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import { RawResponse } from '../common/api-endpoint.decorator.js';
import { Database } from '../database/database.js';
import { REDIS } from '../redis/redis.module.js';

// Protected by the global JwtAuthGuard: no @Public().
@ApiTags('health')
@ApiBearerAuth()
// Terminus shape is kept so probes and monitors can parse it.
@RawResponse()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicators: HealthIndicatorService,
    private readonly database: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @ApiOperation({
    summary: 'Check dependencies',
    description:
      'Pings Postgres and Redis. Returns 503 with the Terminus body when either is down. Requires a valid JWT.',
  })
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
