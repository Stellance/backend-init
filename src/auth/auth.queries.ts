import { and, eq, inArray, lt } from 'drizzle-orm';
import type { Executor, Tx } from '../database/database.js';
import {
  type OneTimeTokenPurpose,
  oneTimeTokens,
  refreshTokens,
  usedRefreshTokens,
  verifiedEmails,
} from '../database/schema/index.js';

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

export const findRefreshToken = async (db: Executor, tokenHash: string) =>
  (
    await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1)
  )[0];

export const findOneTimeToken = async (
  db: Executor,
  tokenHash: string,
  purpose: OneTimeTokenPurpose,
) =>
  (
    await db
      .select()
      .from(oneTimeTokens)
      .where(
        and(
          eq(oneTimeTokens.tokenHash, tokenHash),
          eq(oneTimeTokens.purpose, purpose),
        ),
      )
      .limit(1)
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

/** Returns the families that lost their live refresh token. */
export const deleteAllForUser = async (
  tx: Tx,
  userId: string,
): Promise<string[]> =>
  (
    await tx
      .delete(refreshTokens)
      .where(eq(refreshTokens.userId, userId))
      .returning({ familyId: refreshTokens.familyId })
  ).map((r) => r.familyId);

/**
 * Replaces the pending token unless it was issued after `reissueAfter`, so
 * repeated requests cannot keep invalidating a link the owner is about to use.
 * Returns whether a token was written.
 */
export const upsertOneTimeToken = async (
  tx: Tx,
  row: typeof oneTimeTokens.$inferInsert,
  reissueAfter: Date,
): Promise<boolean> =>
  (
    await tx
      .insert(oneTimeTokens)
      .values(row)
      .onConflictDoUpdate({
        target: [oneTimeTokens.userId, oneTimeTokens.purpose],
        set: {
          tokenHash: row.tokenHash,
          expiresAt: row.expiresAt,
          createdAt: new Date(),
        },
        setWhere: lt(oneTimeTokens.createdAt, reissueAfter),
      })
      .returning({ userId: oneTimeTokens.userId })
  ).length > 0;

/** Atomic consume: of two concurrent callers only one gets the row. */
export const consumeOneTimeToken = async (
  tx: Tx,
  tokenHash: string,
  purpose: OneTimeTokenPurpose,
) =>
  (
    await tx
      .delete(oneTimeTokens)
      .where(
        and(
          eq(oneTimeTokens.tokenHash, tokenHash),
          eq(oneTimeTokens.purpose, purpose),
        ),
      )
      .returning()
  )[0];

export const markEmailVerified = (tx: Tx, userId: string) =>
  tx.insert(verifiedEmails).values({ userId }).onConflictDoNothing();

export const isEmailVerified = async (
  db: Executor,
  userId: string,
): Promise<boolean> =>
  (
    await db
      .select({ userId: verifiedEmails.userId })
      .from(verifiedEmails)
      .where(eq(verifiedEmails.userId, userId))
      .limit(1)
  ).length > 0;

export const PRUNE_BATCH = 1000;

/** Deletes up to PRUNE_BATCH used-token rows; callers loop until fewer come back. */
export const pruneUsedRefreshTokens = async (tx: Tx, before: Date) =>
  (
    await tx
      .delete(usedRefreshTokens)
      .where(
        inArray(
          usedRefreshTokens.tokenHash,
          tx
            .select({ h: usedRefreshTokens.tokenHash })
            .from(usedRefreshTokens)
            .where(lt(usedRefreshTokens.usedAt, before))
            .limit(PRUNE_BATCH)
            .for('update', { skipLocked: true }),
        ),
      )
      .returning({ h: usedRefreshTokens.tokenHash })
  ).length;

export const pruneExpiredRefreshTokens = async (tx: Tx, now: Date) =>
  (
    await tx
      .delete(refreshTokens)
      .where(
        inArray(
          refreshTokens.tokenHash,
          tx
            .select({ h: refreshTokens.tokenHash })
            .from(refreshTokens)
            .where(lt(refreshTokens.expiresAt, now))
            .limit(PRUNE_BATCH)
            .for('update', { skipLocked: true }),
        ),
      )
      .returning({ h: refreshTokens.tokenHash })
  ).length;

export const pruneExpiredOneTimeTokens = async (tx: Tx, now: Date) =>
  (
    await tx
      .delete(oneTimeTokens)
      .where(
        inArray(
          oneTimeTokens.tokenHash,
          tx
            .select({ h: oneTimeTokens.tokenHash })
            .from(oneTimeTokens)
            .where(lt(oneTimeTokens.expiresAt, now))
            .limit(PRUNE_BATCH)
            .for('update', { skipLocked: true }),
        ),
      )
      .returning({ h: oneTimeTokens.tokenHash })
  ).length;
