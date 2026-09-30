import type { Db } from "../utils/prisma.js";

// Append-only audit trail. There is intentionally no update/delete path here -
// the log is immutable from the normal admin interface.
export async function logAudit(
  db: Db,
  entry: {
    adminId?: string | null;
    userId?: string | null;
    action: string;
    detail?: unknown;
    ip?: string | null;
  }
) {
  return (db as any).auditLog.create({
    data: {
      adminId: entry.adminId ?? null,
      userId: entry.userId ?? null,
      action: entry.action,
      ip: entry.ip ?? null,
      detail: entry.detail === undefined ? undefined : JSON.parse(JSON.stringify(entry.detail)),
    },
  });
}
