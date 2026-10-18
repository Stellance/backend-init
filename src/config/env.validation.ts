import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsString,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

export enum LogLevel {
  Fatal = 'fatal',
  Error = 'error',
  Warn = 'warn',
  Info = 'info',
  Debug = 'debug',
  Trace = 'trace',
  Silent = 'silent',
}

const toBoolean = ({ value }: { value: unknown }) =>
  value === true || value === 'true';

export class EnvVars {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 3000;

  @IsEnum(LogLevel)
  LOG_LEVEL: LogLevel = LogLevel.Info;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  DB_POOL_MAX = 10;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  DB_STATEMENT_TIMEOUT_MS = 15000;

  @IsString()
  @IsNotEmpty()
  REDIS_URL: string;

  @IsString()
  @MinLength(32)
  JWT_ACCESS_SECRET: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  ACCESS_TOKEN_TTL_SECONDS = 900;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  REFRESH_TOKEN_TTL_DAYS = 30;

  /** Comma-separated allowlist. Empty disables CORS. */
  @IsString()
  CORS_ORIGINS = '';

  /** Number of reverse proxies in front of the app (Railway edge = 1). */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  TRUST_PROXY_HOPS = 0;

  @Transform(toBoolean)
  @IsBoolean()
  SWAGGER_ENABLED = false;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  RATE_LIMIT_CAPACITY = 60;

  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  RATE_LIMIT_REFILL_PER_SEC = 1;
}

export function validateEnv(raw: Record<string, unknown>): EnvVars {
  const env = plainToInstance(EnvVars, raw, { exposeDefaultValues: true });
  const errors = validateSync(env, { whitelist: false });
  if (errors.length > 0) {
    const lines = errors.map(
      (e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
    );
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  return env;
}
