import { HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { configStub, fakeContext } from '../../test/fake-context.js';
import { RateLimitGuard } from './rate-limit.guard.js';
import { RATE_LIMIT_KEY } from './rate-limit.decorator.js';
import type { TakeResult, TokenBucketStore } from './token-bucket.store.js';

const ok = (remaining: number): TakeResult => ({
  allowed: true,
  remaining,
  retryAfterMs: 0,
});

const build = (take: (key: string) => Promise<TakeResult>) => {
  const keys: string[] = [];
  const store = {
    take: (key: string) => {
      keys.push(key);
      return take(key);
    },
  } as unknown as TokenBucketStore;
  const guard = new RateLimitGuard(
    store,
    new Reflector(),
    configStub({ RATE_LIMIT_CAPACITY: 60, RATE_LIMIT_REFILL_PER_SEC: 1 }),
  );
  return { guard, keys };
};

describe('RateLimitGuard', () => {
  it('keys by user when authenticated and by ip otherwise', async () => {
    const { guard, keys } = build(async () => ok(5));
    await guard.canActivate(fakeContext({ user: { id: 'u1' } }).ctx);
    await guard.canActivate(fakeContext({ ip: '1.2.3.4' }).ctx);
    expect(keys).toEqual(['rl:global:user:u1', 'rl:global:ip:1.2.3.4']);
  });

  it('exposes the remaining budget', async () => {
    const { guard } = build(async () => ok(41));
    const { ctx, http } = fakeContext({ ip: 'x' });
    await guard.canActivate(ctx);
    expect(http.headers['RateLimit-Limit']).toBe(60);
    expect(http.headers['RateLimit-Remaining']).toBe(41);
  });

  it('checks the route bucket too and reports the tighter one', async () => {
    const handler = function limited() {};
    Reflect.defineMetadata(
      RATE_LIMIT_KEY,
      { capacity: 5, refillPerSec: 0.1 },
      handler,
    );
    const { guard, keys } = build(async (k) =>
      ok(k.startsWith('rl:global') ? 50 : 2),
    );
    const { ctx, http } = fakeContext({ ip: 'x' }, handler);
    await guard.canActivate(ctx);
    expect(keys).toHaveLength(2);
    expect(http.headers['RateLimit-Limit']).toBe(5);
    expect(http.headers['RateLimit-Remaining']).toBe(2);
  });

  it('throws 429 with Retry-After when a bucket is empty', async () => {
    const { guard } = build(async () => ({
      allowed: false,
      remaining: 0,
      retryAfterMs: 2500,
    }));
    const { ctx, http } = fakeContext({ ip: 'x' });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      status: 429,
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(HttpException);
    expect(http.headers['Retry-After']).toBe(3);
    expect(http.headers['RateLimit-Remaining']).toBe(0);
  });

  it('fails open when the store errors', async () => {
    const { guard } = build(async () => {
      throw new Error('redis down');
    });
    await expect(guard.canActivate(fakeContext({ ip: 'x' }).ctx)).resolves.toBe(
      true,
    );
  });
});
