import { and, count, desc, eq, type SQL } from 'drizzle-orm';
import { getRequestContext } from '../common/request-context.js';
import type { Executor, Tx } from '../database/database.js';
import { auditLog } from '../database/schema/index.js';

export interface AuditEvent {
  action: string;
  actorId?: string | null;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}

/** Requires a Tx so the audit row commits or rolls back with the change it describes. */
export const recordAudit = async (tx: Tx, event: AuditEvent): Promise<void> => {
  const ctx = getRequestContext();
  await tx.insert(auditLog).values({
    action: event.action,
    actorId: event.actorId ?? ctx?.userId ?? null,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    metadata: event.metadata,
    requestId: ctx?.requestId,
    traceId: ctx?.traceId,
    ip: ctx?.ip,
  });
};

export const listAudit = async (
  db: Executor,
  filter: { action?: string; actorId?: string },
  page: { limit: number; offset: number },
) => {
  const conditions: SQL[] = [];
  if (filter.action) conditions.push(eq(auditLog.action, filter.action));
  if (filter.actorId) conditions.push(eq(auditLog.actorId, filter.actorId));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(auditLog)
      .where(where)
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(page.limit)
      .offset(page.offset),
    db.select({ total: count() }).from(auditLog).where(where),
  ]);
  return { rows, total };
};
