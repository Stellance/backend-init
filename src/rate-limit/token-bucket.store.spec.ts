import type { Redis } from 'ioredis';
import { TokenBucketStore } from './token-bucket.store.js';

describe('TokenBucketStore', () => {
  const build = (reply: [number, number, number]) => {
    const calls: unknown[][] = [];
    const defineCommand = vi.fn();
    const redis = {
      defineCommand,
      takeToken: (...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve(reply);
      },
    } as unknown as Redis;
    return { store: new TokenBucketStore(redis), calls, defineCommand };
  };

  it('registers the lua command once', () => {
    const { defineCommand } = build([1, 0, 0]);
    expect(defineCommand).toHaveBeenCalledWith(
      'takeToken',
      expect.objectContaining({ numberOfKeys: 1 }),
    );
  });

  it('maps the script reply', async () => {
    const { store, calls } = build([0, 0, 1200]);
    const out = await store.take('k', { capacity: 5, refillPerSec: 0.5 }, 2);
    expect(out).toEqual({ allowed: false, remaining: 0, retryAfterMs: 1200 });
    expect(calls[0]).toEqual(['k', 5, 0.5, 2]);
  });

  it('reports allowed when the script returns 1', async () => {
    const { store } = build([1, 4, 0]);
    expect(await store.take('k', { capacity: 5, refillPerSec: 1 })).toEqual({
      allowed: true,
      remaining: 4,
      retryAfterMs: 0,
    });
  });
});
