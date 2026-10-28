import { configStub } from '../../test/fake-context.js';
import type { Database } from '../database/database.js';
import * as queries from './auth.queries.js';
import { TokenCleanupService } from './token-cleanup.service.js';

vi.mock('./auth.queries.js', async (orig) => ({
  ...(await orig<typeof queries>()),
  pruneUsedRefreshTokens: vi.fn(),
  pruneExpiredRefreshTokens: vi.fn(),
  pruneExpiredOneTimeTokens: vi.fn(),
}));

const q = vi.mocked(queries);
const database = {
  transaction: (fn: (tx: object) => unknown) => fn({}),
} as unknown as Database;
const build = (minutes = 0) =>
  new TokenCleanupService(
    database,
    configStub({
      TOKEN_CLEANUP_INTERVAL_MINUTES: minutes,
      REFRESH_TOKEN_TTL_DAYS: 30,
    }),
  );

beforeEach(() => vi.resetAllMocks());

describe('TokenCleanupService', () => {
  it('keeps used tokens for the refresh lifetime', async () => {
    q.pruneUsedRefreshTokens.mockResolvedValue(0);
    q.pruneExpiredRefreshTokens.mockResolvedValue(0);
    q.pruneExpiredOneTimeTokens.mockResolvedValue(0);
    const now = new Date('2026-06-30T00:00:00Z');
    await build().run(now);
    expect(q.pruneUsedRefreshTokens.mock.calls[0][1]).toEqual(
      new Date('2026-05-31T00:00:00Z'),
    );
    expect(q.pruneExpiredRefreshTokens.mock.calls[0][1]).toEqual(now);
  });

  it('loops until a batch comes back short and sums the deletes', async () => {
    q.pruneUsedRefreshTokens
      .mockResolvedValueOnce(queries.PRUNE_BATCH)
      .mockResolvedValueOnce(7);
    q.pruneExpiredRefreshTokens.mockResolvedValue(0);
    q.pruneExpiredOneTimeTokens.mockResolvedValue(3);
    expect(await build().run()).toEqual({
      usedRefreshTokens: queries.PRUNE_BATCH + 7,
      refreshTokens: 0,
      oneTimeTokens: 3,
    });
  });

  it('one failing table does not stop the others', async () => {
    q.pruneUsedRefreshTokens.mockRejectedValue(new Error('boom'));
    q.pruneExpiredRefreshTokens.mockResolvedValue(2);
    q.pruneExpiredOneTimeTokens.mockResolvedValue(1);
    expect(await build().run()).toEqual({
      usedRefreshTokens: 0,
      refreshTokens: 2,
      oneTimeTokens: 1,
    });
  });

  it('schedules a sweep only when the interval is positive', () => {
    vi.useFakeTimers();
    try {
      q.pruneUsedRefreshTokens.mockResolvedValue(0);
      q.pruneExpiredRefreshTokens.mockResolvedValue(0);
      q.pruneExpiredOneTimeTokens.mockResolvedValue(0);

      const off = build(0);
      off.onApplicationBootstrap();
      vi.advanceTimersByTime(3_600_000);
      expect(q.pruneUsedRefreshTokens).not.toHaveBeenCalled();

      const on = build(1);
      on.onApplicationBootstrap();
      vi.advanceTimersByTime(60_000);
      expect(q.pruneUsedRefreshTokens).toHaveBeenCalledOnce();
      on.onApplicationShutdown();
    } finally {
      vi.useRealTimers();
    }
  });
});
