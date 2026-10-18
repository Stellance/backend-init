import { validateEnv } from './env.validation.js';

const valid = {
  DATABASE_URL: 'postgres://u@localhost/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
};

describe('validateEnv', () => {
  it('applies defaults and coerces numbers and booleans', () => {
    const env = validateEnv({
      ...valid,
      PORT: '8080',
      SWAGGER_ENABLED: 'true',
    });
    expect(env.PORT).toBe(8080);
    expect(env.SWAGGER_ENABLED).toBe(true);
    expect(env.NODE_ENV).toBe('development');
    expect(env.RATE_LIMIT_CAPACITY).toBe(60);
  });

  it('defaults swagger to off', () => {
    expect(validateEnv(valid).SWAGGER_ENABLED).toBe(false);
  });

  it('fails fast listing every problem', () => {
    expect(() =>
      validateEnv({ JWT_ACCESS_SECRET: 'short', NODE_ENV: 'staging' }),
    ).toThrow(/DATABASE_URL[\s\S]*REDIS_URL|REDIS_URL[\s\S]*DATABASE_URL/);
  });

  it('rejects a weak JWT secret', () => {
    expect(() => validateEnv({ ...valid, JWT_ACCESS_SECRET: 'short' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });
});
