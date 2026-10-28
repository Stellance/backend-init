import { count, desc, eq } from 'drizzle-orm';
import type { Executor, Tx } from '../database/database.js';
import { users, type Role } from '../database/schema/index.js';

export interface UserRow {
  id: string;
  email: string;
  passwordHash: string;
  role: Role;
  createdAt: Date;
}

export const findUserByEmail = async (
  db: Executor,
  email: string,
): Promise<UserRow | undefined> =>
  (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];

export const findUserById = async (
  db: Executor,
  id: string,
): Promise<UserRow | undefined> =>
  (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];

/**
 * Serialises session-changing writes (login, refresh, logout, reset,
 * logout-all) per user. Take it before any refresh_tokens row lock.
 */
export const lockUser = (tx: Tx, id: string) =>
  tx.select({ id: users.id }).from(users).where(eq(users.id, id)).for('update');

export const insertUser = async (
  tx: Tx,
  values: { email: string; passwordHash: string },
): Promise<UserRow> => (await tx.insert(users).values(values).returning())[0];

export const updatePasswordHash = (
  tx: Tx,
  userId: string,
  passwordHash: string,
) => tx.update(users).set({ passwordHash }).where(eq(users.id, userId));

export const listUsers = async (
  db: Executor,
  page: { limit: number; offset: number },
): Promise<{ rows: Omit<UserRow, 'passwordHash'>[]; total: number }> => {
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt), desc(users.id))
      .limit(page.limit)
      .offset(page.offset),
    db.select({ total: count() }).from(users),
  ]);
  return { rows, total };
};
