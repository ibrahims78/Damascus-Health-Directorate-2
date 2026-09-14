import { db, auditLogTable } from "@workspace/db";
import type { Request } from "express";

interface AuditParams {
  req: Request;
  action: string;
  entityType: string;
  entityId?: number | null;
  details?: Record<string, unknown> | null;
}

/**
 * Log an action to the audit_log table.
 * Fails silently — never throws so it doesn't break the main request.
 */
export async function auditLog(params: AuditParams): Promise<void> {
  try {
    await auditLogStrict(params);
  } catch (err) {
    // Audit failures must never break the main flow
    console.error("[audit] failed to write audit log:", err);
  }
}

/**
 * Strict variant used by the inventory movement service for failed operations.
 * A failed movement must be visible to the caller if its failure cannot be
 * audited; successful movement audits are written through the same DB
 * transaction by the service itself.
 */
export async function auditLogStrict(params: AuditParams): Promise<void> {
  const user = params.req.res?.locals.user as
    | { id?: number; fullName?: string }
    | undefined;
  await db.insert(auditLogTable).values({
    userId: user?.id ?? null,
    userNameSnap: user?.fullName ?? null,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId ?? null,
    details: params.details ?? null,
    ipAddress:
      (params.req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
      params.req.socket?.remoteAddress ??
      null,
  });
}
