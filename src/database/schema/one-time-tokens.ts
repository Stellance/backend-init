import {
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const oneTimeTokenPurposeEnum = pgEnum('one_time_token_purpose', [
  'verify_email',
  'reset_password',
]);

export type OneTimeTokenPurpose =
  (typeof oneTimeTokenPurposeEnum.enumValues)[number];

// Row exists = token is pending. Consuming deletes it; issuing a new one for
// the same (user, purpose) replaces the old one.
export const oneTimeTokens = pgTable(
  'one_time_tokens',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: oneTimeTokenPurposeEnum().notNull(),
    tokenHash: text().notNull().unique(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.purpose] }),
    index('one_time_tokens_expires_idx').on(t.expiresAt),
  ],
);
