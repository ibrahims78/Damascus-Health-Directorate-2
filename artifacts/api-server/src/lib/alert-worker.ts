/**
 * Alert Worker — background process that:
 *  1. Computes all current alert conditions from DB
 *  2. Upserts active alerts (one row per type+entity, unique constraint)
 *  3. Auto-resolves alerts whose condition has cleared
 *  4. Broadcasts a refresh signal via SSE to all connected clients
 *  5. Clears read-marks when an alert severity escalates (warning → critical)
 *
 * Runs once on startup (after a 5 s delay) then every 2 hours.
 */

import {
  db,
  alertsTable,
  alertReadsTable,
  itemsTable,
  equipmentTable,
  systemSettingsTable,
} from "@workspace/db";
import {
  eq,
  and,
  lte,
  lt,
  gt,
  sql,
  inArray,
  notInArray,
  isNotNull,
} from "drizzle-orm";
import { broadcastAlertUpdate } from "./sse-manager";
import { logger } from "./logger";

type AlertCandidate = {
  type:
    | "below_min"
    | "near_expiry"
    | "equipment_maintenance"
    | "equipment_below_min";
  entityId: number;
  entityType: "item" | "equipment";
  severity: "critical" | "warning" | "info";
  message: string;
};

async function computeActiveAlerts(
  expiryAlertDays: number
): Promise<AlertCandidate[]> {
  const alertDate = new Date();
  alertDate.setDate(alertDate.getDate() + expiryAlertDays);
  const alertDateStr = alertDate.toISOString().split("T")[0];

  const [belowMin, nearExpiry, needsMaintenance, equipmentBelowMin] =
    await Promise.all([
      // Items below or at minimum stock (only meaningful when minStock > 0)
      db
        .select({
          id: itemsTable.id,
          name: itemsTable.name,
          currentStock: itemsTable.currentStock,
          minStock: itemsTable.minStock,
        })
        .from(itemsTable)
        .where(
          and(
            eq(itemsTable.isActive, true),
            gt(itemsTable.minStock, 0),
            lte(itemsTable.currentStock, itemsTable.minStock)
          )
        ),

      // Items near expiry or already expired
      db
        .select({
          id: itemsTable.id,
          name: itemsTable.name,
          expiryDate: itemsTable.expiryDate,
        })
        .from(itemsTable)
        .where(
          and(
            eq(itemsTable.isActive, true),
            sql`${itemsTable.expiryDate} IS NOT NULL`,
            sql`${itemsTable.expiryDate} <= ${alertDateStr}`
          )
        ),

      // Equipment needing maintenance or inspection
      db
        .select({
          id: equipmentTable.id,
          name: equipmentTable.name,
          condition: equipmentTable.condition,
        })
        .from(equipmentTable)
        .where(
          inArray(equipmentTable.condition, ["maintenance", "needs_inspection"])
        ),

      // Equipment below minimum quantity (only when minQuantity > 0)
      db
        .select({
          id: equipmentTable.id,
          name: equipmentTable.name,
          quantity: equipmentTable.quantity,
          minQuantity: equipmentTable.minQuantity,
        })
        .from(equipmentTable)
        .where(
          and(
            gt(equipmentTable.minQuantity, 0),
            lt(equipmentTable.quantity, equipmentTable.minQuantity)
          )
        ),
    ]);

  const now = new Date().toISOString().split("T")[0];

  return [
    ...belowMin.map((item): AlertCandidate => ({
      type: "below_min",
      entityId: item.id,
      entityType: "item",
      severity: item.currentStock === 0 ? "critical" : "warning",
      message: `${item.name}: الرصيد الحالي (${item.currentStock}) أقل من أو يساوي الحد الأدنى (${item.minStock})`,
    })),
    ...nearExpiry.map((item): AlertCandidate => {
      const expired = item.expiryDate != null && item.expiryDate < now;
      return {
        type: "near_expiry",
        entityId: item.id,
        entityType: "item",
        severity: expired ? "critical" : "warning",
        message: expired
          ? `${item.name}: انتهت الصلاحية بتاريخ ${item.expiryDate}`
          : `${item.name}: تنتهي الصلاحية بتاريخ ${item.expiryDate}`,
      };
    }),
    ...needsMaintenance.map((eq_): AlertCandidate => ({
      type: "equipment_maintenance",
      entityId: eq_.id,
      entityType: "equipment",
      severity: "warning",
      message:
        eq_.condition === "maintenance"
          ? `${eq_.name}: تحت الصيانة`
          : `${eq_.name}: يحتاج فحص وصيانة`,
    })),
    ...equipmentBelowMin.map((eq_): AlertCandidate => ({
      type: "equipment_below_min",
      entityId: eq_.id,
      entityType: "equipment",
      severity: eq_.quantity === 0 ? "critical" : "warning",
      message: `${eq_.name}: الكمية الحالية (${eq_.quantity}) أقل من الحد الأدنى (${eq_.minQuantity})`,
    })),
  ];
}

export async function runAlertWorker(): Promise<void> {
  try {
    logger.info("Alert worker: starting run");

    // 1. Read settings
    const settings = await db.query.systemSettingsTable.findFirst();
    const expiryAlertDays = settings?.expiryAlertDays ?? 30;

    // 2. Compute what should be active
    const active = await computeActiveAlerts(expiryAlertDays);

    // 3. Pre-fetch existing unresolved alerts to detect severity escalations
    const existing = await db
      .select()
      .from(alertsTable)
      .where(eq(alertsTable.isResolved, false));

    const existingMap = new Map(
      existing.map((a) => [`${a.type}:${a.entityId}:${a.entityType}`, a])
    );

    // Fetch keys of alerts that were manually resolved (resolvedBy IS NOT NULL).
    // The worker must never re-open these — the user explicitly dismissed them.
    const manuallyResolved = await db
      .select({
        type: alertsTable.type,
        entityId: alertsTable.entityId,
        entityType: alertsTable.entityType,
      })
      .from(alertsTable)
      .where(
        and(eq(alertsTable.isResolved, true), isNotNull(alertsTable.resolvedBy))
      );

    const manuallyResolvedKeys = new Set(
      manuallyResolved.map((a) => `${a.type}:${a.entityId}:${a.entityType}`)
    );

    // 4. Upsert active alerts
    const upsertedIds: number[] = [];
    const escalatedIds: number[] = []; // alerts whose severity increased

    for (const alert of active) {
      const key = `${alert.type}:${alert.entityId}:${alert.entityType}`;

      // Skip alerts the admin manually resolved — don't undo their action
      if (manuallyResolvedKeys.has(key)) continue;
      const prev = existingMap.get(key);

      const [upserted] = await db
        .insert(alertsTable)
        .values({
          type: alert.type,
          entityId: alert.entityId,
          entityType: alert.entityType,
          severity: alert.severity,
          message: alert.message,
          isResolved: false,
        })
        .onConflictDoUpdate({
          target: [
            alertsTable.type,
            alertsTable.entityId,
            alertsTable.entityType,
          ],
          set: {
            severity: alert.severity,
            message: alert.message,
            isResolved: false,
            resolvedAt: sql`NULL`,
            resolvedBy: sql`NULL`,
          },
        })
        .returning({ id: alertsTable.id, severity: alertsTable.severity });

      if (!upserted) continue;
      upsertedIds.push(upserted.id);

      // Detect severity escalation (warning → critical)
      if (
        prev &&
        prev.severity !== "critical" &&
        upserted.severity === "critical"
      ) {
        escalatedIds.push(upserted.id);
      }
    }

    // 5. Delete read-marks for escalated alerts (re-notify users)
    if (escalatedIds.length > 0) {
      await db
        .delete(alertReadsTable)
        .where(inArray(alertReadsTable.alertId, escalatedIds));
    }

    // 6. Auto-resolve alerts whose condition has cleared
    const activeKeys = new Set(
      active.map((a) => `${a.type}:${a.entityId}:${a.entityType}`)
    );
    const toResolveIds = existing
      .filter(
        (a) => !activeKeys.has(`${a.type}:${a.entityId}:${a.entityType}`)
      )
      .map((a) => a.id);

    if (toResolveIds.length > 0) {
      await db
        .update(alertsTable)
        .set({ isResolved: true, resolvedAt: new Date() })
        .where(inArray(alertsTable.id, toResolveIds));
    }

    logger.info(
      {
        active: active.length,
        upserted: upsertedIds.length,
        escalated: escalatedIds.length,
        resolved: toResolveIds.length,
      },
      "Alert worker: done"
    );

    // 7. Notify connected clients
    broadcastAlertUpdate();
  } catch (err) {
    logger.error({ err }, "Alert worker: error");
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

let _intervalId: ReturnType<typeof setInterval> | null = null;

export function startAlertWorker(): void {
  // First run after 5 s (give DB a moment after startup)
  setTimeout(() => runAlertWorker(), 5_000);
  // Then every 2 hours
  _intervalId = setInterval(() => runAlertWorker(), 2 * 60 * 60 * 1_000);
  logger.info("Alert worker: scheduled (every 2 h)");
}

export function stopAlertWorker(): void {
  if (_intervalId) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
}
