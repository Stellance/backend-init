import { pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

// Row exists = the user proved control of their email.
export const verifiedEmails = pgTable('verified_emails', {
  userId: uuid()
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  verifiedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
