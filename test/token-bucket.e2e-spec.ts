import { v7 } from 'uuid';
import { Redis } from 'ioredis';
import { TokenBucketStore } from '../src/rate-limit/token-bucket.store.js';

describe('TokenBucketStore (real Redis)', () => {
  let redis: Redis;
  let store: TokenBucketStore;

  beforeAll(() => {
    redis = new Redis(process.env.REDIS_URL!);
    store = new TokenBucketStore(redis);
  });

  afterAll(async () => {
    await redis.quit();
  });

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('allows a burst up to capacity, then denies with a retry hint', async () => {
    const key = `test:${v7()}`;
    const bucket = { capacity: 3, refillPerSec: 1 };
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await store.take(key, bucket));

    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0, 0]);
    expect(results[3].retryAfterMs).toBeGreaterThan(0);
    expect(results[3].retryAfterMs).toBeLessThanOrEqual(1000);
  });

  it('refills over time without exceeding capacity', async () => {
    const key = `test:${v7()}`;
    const bucket = { capacity: 2, refillPerSec: 20 };
    await store.take(key, bucket);
    await store.take(key, bucket);
    expect((await store.take(key, bucket)).allowed).toBe(false);

    await sleep(120);
    expect((await store.take(key, bucket)).allowed).toBe(true);

    await sleep(400);
    const afterIdle = await store.take(key, bucket);
    expect(afterIdle.remaining).toBe(1);
  });

  it('is atomic under concurrency: exactly capacity requests win', async () => {
    const key = `test:${v7()}`;
    const bucket = { capacity: 5, refillPerSec: 0.001 };
    const results = await Promise.all(
      Array.from({ length: 40 }, () => store.take(key, bucket)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });

  it('expires idle keys', async () => {
    const key = `test:${v7()}`;
    await store.take(key, { capacity: 1, refillPerSec: 100 });
    const ttl = await redis.pttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(1010);
  });
});
