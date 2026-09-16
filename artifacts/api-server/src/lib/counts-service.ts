import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  countLinesTable,
  countSessionsTable,
  db,
  itemsTable,
  usersTable,
} from "@workspace/db";
import { createInventoryMovement } from "./inventory-movement-service";
import { nextDocumentNumber } from "./warehouse-service";

/**
 * P0 - cycle counting (warehouse practice audit).
 *
 * Blind counts by default: the counter does not see the system quantity. The
 * session is approved by an admin, and every difference is then posted through
 * the normal movement service (`adjust`), so batches/allocations stay coherent
 * and the whole approval is reversible through the standard reversal path.
 * Nothing is written before approval.
 */

export class CountError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export type CountEntry = {
  lineId: number;
  countedQuantity: number | null;
  varianceReason?: string | null;
};

export async function createCountSession(input: {
  warehouseId: number;
  scope?: string;
  categoryId?: number | null;
  blindCount?: boolean;
  notes?: string | null;
  userId?: number | null;
  userName?: string | null;
}) {
  const code = (await nextDocumentNumber("CNT")) ?? `CNT-${Date.now()}`;
  const conditions = [eq(itemsTable.isActive, true), eq(itemsTable.itemType, "item")];
  if (input.categoryId) conditions.push(eq(itemsTable.categoryId, input.categoryId));
  const rows = await db
    .select({
      id: itemsTable.id,
      code: itemsTable.code,
      name: itemsTable.name,
      unit: itemsTable.unit,
      currentStock: itemsTable.currentStock,
      binCode: itemsTable.binCode,
    })
    .from(itemsTable)
    .where(and(...conditions))
    .orderBy(asc(itemsTable.name));

  if (rows.length === 0) {
    throw new CountError("COUNT_NO_ITEMS", "لا توجد أصناف مطابقة لنطاق الجرد.", 409);
  }

  return db.transaction(async (tx) => {
    const [session] = await tx
      .insert(countSessionsTable)
      .values({
        code,
        status: "open",
        warehouseId: input.warehouseId,
        scope: input.scope ?? "full",
        categoryId: input.categoryId ?? null,
        blindCount: input.blindCount ?? true,
        notes: input.notes ?? null,
        createdByUserId: input.userId ?? null,
        createdByName: input.userName ?? null,
        linesCount: rows.length,
      })
      .returning();
    await tx.insert(countLinesTable).values(
      rows.map((row) => ({
        sessionId: session.id,
        itemId: row.id,
        itemCode: row.code,
        itemName: row.name,
        unit: row.unit,
        binCode: row.binCode,
        systemQuantity: Number(row.currentStock ?? 0),
      })),
    );
    return session;
  });
}

export async function listCountSessions(limit = 100) {
  return db
    .select({
      id: countSessionsTable.id,
      code: countSessionsTable.code,
      status: countSessionsTable.status,
      warehouseId: countSessionsTable.warehouseId,
      scope: countSessionsTable.scope,
      blindCount: countSessionsTable.blindCount,
      linesCount: countSessionsTable.linesCount,
      countedLines: countSessionsTable.countedLines,
      varianceLines: countSessionsTable.varianceLines,
      totalVariance: countSessionsTable.totalVariance,
      createdByName: countSessionsTable.createdByName,
      approvedByName: countSessionsTable.approvedByName,
      startedAt: countSessionsTable.startedAt,
      approvedAt: countSessionsTable.approvedAt,
      createdAt: countSessionsTable.createdAt,
    })
    .from(countSessionsTable)
    .orderBy(desc(countSessionsTable.createdAt))
    .limit(Math.min(500, Math.max(1, limit)));
}

export async function getCountSession(id: number) {
  const [session] = await db.select().from(countSessionsTable).where(eq(countSessionsTable.id, id)).limit(1);
  if (!session) throw new CountError("COUNT_NOT_FOUND", "جلسة الجرد غير موجودة.", 404);
  const lines = await db
    .select()
    .from(countLinesTable)
    .where(eq(countLinesTable.sessionId, id))
    .orderBy(asc(countLinesTable.itemName));
  return { ...session, lines };
}

/** Records the physical quantities. Only an open session accepts counts. */
export async function recordCountEntries(
  sessionId: number,
  entries: CountEntry[],
  countedByName: string | null,
) {
  const session = await getCountSession(sessionId);
  if (session.status !== "open") {
    throw new CountError("COUNT_NOT_OPEN", "لا يمكن إدخال جرد لجلسة مغلقة.", 409);
  }
  const byId = new Map(session.lines.map((line) => [Number(line.id), line]));
  const now = new Date();
  await db.transaction(async (tx) => {
    for (const entry of entries) {
      const line = byId.get(Number(entry.lineId));
      if (!line) continue;
      const counted = entry.countedQuantity === null ? null : Math.max(0, Math.trunc(Number(entry.countedQuantity)));
      const variance = counted === null ? null : counted - Number(line.systemQuantity);
      await tx
        .update(countLinesTable)
        .set({
          countedQuantity: counted,
          variance,
          varianceReason: entry.varianceReason ? String(entry.varianceReason).trim() : line.varianceReason ?? null,
          countedByName,
          countedAt: now,
        })
        .where(eq(countLinesTable.id, line.id));
    }
  });
  return refreshCountTotals(sessionId);
}

/** Recomputes the session counters from its lines. */
export async function refreshCountTotals(sessionId: number) {
  const [row] = await db
    .select({
      counted: sql<number>`count(*) filter (where ${countLinesTable.countedQuantity} is not null)`,
      variances: sql<number>`count(*) filter (where ${countLinesTable.variance} is not null and ${countLinesTable.variance} <> 0)`,
      total: sql<number>`coalesce(sum(${countLinesTable.variance}), 0)`,
    })
    .from(countLinesTable)
    .where(eq(countLinesTable.sessionId, sessionId));
  const [session] = await db
    .update(countSessionsTable)
    .set({
      countedLines: Number(row?.counted ?? 0),
      varianceLines: Number(row?.variances ?? 0),
      totalVariance: Number(row?.total ?? 0),
      updatedAt: new Date(),
    })
    .where(eq(countSessionsTable.id, sessionId))
    .returning();
  return session;
}

/**
 * Approves a session: posts one adjustment per variance line and closes it.
 * Refuses while any line is still uncounted so a partial count cannot be
 * rubber-stamped.
 */
export async function approveCountSession(
  sessionId: number,
  context: Parameters<typeof createInventoryMovement>[1],
  user: { id?: number | null; fullName?: string | null } | null,
) {
  const session = await getCountSession(sessionId);
  if (session.status !== "open") {
    throw new CountError("COUNT_NOT_OPEN", "الجلسة ليست مفتوحة.", 409);
  }
  const uncounted = session.lines.filter((line) => line.countedQuantity === null);
  if (uncounted.length > 0) {
    throw new CountError(
      "COUNT_INCOMPLETE",
      `لا يمكن الاعتماد: ${uncounted.length} سطرًا لم يُجرَد بعد.`,
      409,
    );
  }
  const missingReason = session.lines.find(
    (line) => Number(line.variance ?? 0) !== 0 && !String(line.varianceReason ?? "").trim(),
  );
  if (missingReason) {
    throw new CountError(
      "COUNT_VARIANCE_REASON_REQUIRED",
      `يجب تسجيل سبب لكل فرق (الصنف: ${missingReason.itemName}).`,
      409,
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const posted: Array<{ lineId: number; itemId: number; newStock: number; variance: number }> = [];

  for (const line of session.lines) {
    const variance = Number(line.variance ?? 0);
    if (variance === 0) continue;
    await createInventoryMovement(
      {
        kind: "adjust",
        itemType: "item",
        itemId: line.itemId,
        newStock: Number(line.countedQuantity),
        documentDate: today,
        documentNumber: session.code,
        reason: `جرد دوري ${session.code}: ${line.varianceReason}`,
        warehouseId: session.warehouseId,
      } as never,
      context,
    );
    posted.push({ lineId: Number(line.id), itemId: Number(line.itemId), newStock: Number(line.countedQuantity), variance });
  }

  await db
    .update(countSessionsTable)
    .set({
      status: "approved",
      approvedAt: new Date(),
      approvedByUserId: user?.id ?? null,
      approvedByName: user?.fullName ?? null,
      updatedAt: new Date(),
    })
    .where(eq(countSessionsTable.id, sessionId));

  return { posted, session: await getCountSession(sessionId) };
}

export async function cancelCountSession(sessionId: number) {
  const session = await getCountSession(sessionId);
  if (session.status !== "open") {
    throw new CountError("COUNT_NOT_OPEN", "لا يمكن إلغاء جلسة مغلقة.", 409);
  }
  const [updated] = await db
    .update(countSessionsTable)
    .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
    .where(eq(countSessionsTable.id, sessionId))
    .returning();
  return updated;
}

/** Count accuracy per session (used by the KPI report). */
export async function countAccuracy() {
  const [row] = await db
    .select({
      sessions: sql<number>`count(*)`,
      approved: sql<number>`count(*) filter (where ${countSessionsTable.status} = 'approved')`,
      lines: sql<number>`coalesce(sum(${countSessionsTable.countedLines}), 0)`,
      varianceLines: sql<number>`coalesce(sum(${countSessionsTable.varianceLines}), 0)`,
    })
    .from(countSessionsTable);
  const lines = Number(row?.lines ?? 0);
  const varianceLines = Number(row?.varianceLines ?? 0);
  return {
    sessions: Number(row?.sessions ?? 0),
    approved: Number(row?.approved ?? 0),
    lines,
    varianceLines,
    accuracy: lines > 0 ? Math.round(((lines - varianceLines) / lines) * 1000) / 10 : null,
  };
}

