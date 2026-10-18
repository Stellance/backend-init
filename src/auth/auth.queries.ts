import { and, eq, lt } from 'drizzle-orm';
import type { Executor, Tx } from '../database/database.js';
import { refreshTokens, usedRefreshTokens } from '../database/schema/index.js';

export const insertRefreshToken = (
  tx: Tx,
  row: typeof refreshTokens.$inferInsert,
) => tx.insert(refreshTokens).values(row);

/** Atomic consume: of two concurrent callers only one gets the row. */
export const consumeRefreshToken = async (tx: Tx, tokenHash: string) =>
  (
    await tx
      .delete(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .returning()
  )[0];

export const markRefreshTokenUsed = (
  tx: Tx,
  row: { tokenHash: string; familyId: string },
) => tx.insert(usedRefreshTokens).values(row).onConflictDoNothing();

export const findUsedRefreshToken = async (db: Executor, tokenHash: string) =>
  (
    await db
      .select()
      .from(usedRefreshTokens)
      .where(eq(usedRefreshTokens.tokenHash, tokenHash))
      .limit(1)
  )[0];

export const deleteFamily = (tx: Tx, familyId: string) =>
  tx.delete(refreshTokens).where(eq(refreshTokens.familyId, familyId));

export const deleteExpiredForUser = (tx: Tx, userId: string) =>
  tx
    .delete(refreshTokens)
    .where(
      and(
        eq(refreshTokens.userId, userId),
        lt(refreshTokens.expiresAt, new Date()),
      ),
    );
