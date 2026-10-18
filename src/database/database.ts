import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type {
  NodePgQueryResultHKT,
  NodePgTransaction,
} from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';
import type { EnvVars } from '../config/env.validation.js';
import * as schema from './schema/index.js';

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema>;
/** Writes take a Tx, so they cannot be called outside a transaction. */
export type Tx = NodePgTransaction<Schema, ExtractTablesWithRelations<Schema>>;
/** Reads accept either a pool-backed Db or a Tx. */
export type Executor = PgDatabase<
  NodePgQueryResultHKT,
  Schema,
  ExtractTablesWithRelations<Schema>
>;

@Injectable()
export class Database implements OnApplicationShutdown {
  private readonly logger = new Logger(Database.name);
  private readonly pool: Pool;
  readonly db: Db;

  constructor(config: ConfigService<EnvVars, true>) {
    this.pool = new Pool({
      connectionString: config.get('DATABASE_URL', { infer: true }),
      max: config.get('DB_POOL_MAX', { infer: true }),
      statement_timeout: config.get('DB_STATEMENT_TIMEOUT_MS', {
        infer: true,
      }),
    });
    this.pool.on('error', (err) =>
      this.logger.error({ err }, 'Idle Postgres client error'),
    );
    this.db = drizzle(this.pool, { schema, casing: 'snake_case' });
  }

  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(fn);
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
