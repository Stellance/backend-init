import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Row exists = token was already rotated. Presenting it again means theft.
export const usedRefreshTokens = pgTable(
  'used_refresh_tokens',
  {
    tokenHash: text().primaryKey(),
    familyId: uuid().notNull(),
    usedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('used_refresh_tokens_used_at_idx').on(t.usedAt)],
);
