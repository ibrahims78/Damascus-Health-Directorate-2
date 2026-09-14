import { db, unitsTable, itemsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { DEFAULT_INVENTORY_UNITS } from "@workspace/api-zod";
import {
  ensureEntityIdentity,
  ensureNodeIdentity,
  recordLocalChange,
} from "./sync-service";

/** Phase 2 - catalog unit service (standard units of measure). */

export async function listUnits(includeArchived = false) {
  const query = db.select().from(unitsTable);
  const rows = includeArchived
    ? await query.orderBy(unitsTable.sortOrder, unitsTable.name)
    : await query.where(eq(unitsTable.isActive, true)).orderBy(unitsTable.sortOrder, unitsTable.name);
  return rows;
}

/** Insert the shipped default units (idempotent by unique name). */
export async function seedDefaultUnits(): Promise<number> {
  let created = 0;
  for (let i = 0; i < DEFAULT_INVENTORY_UNITS.length; i++) {
    const name = String(DEFAULT_INVENTORY_UNITS[i] ?? "").trim();
    if (!name) continue;
    const inserted = await db
      .insert(unitsTable)
      .values({ name, isSystem: true, sortOrder: i })
      .onConflictDoNothing({ target: unitsTable.name })
      .returning({ id: unitsTable.id });
    if (inserted.length > 0) created += 1;
  }
  return created;
}

/** Distinct unit strings currently used by items, and whether they are known. */
export async function unitUsage(): Promise<
  Array<{ unit: string; count: number; known: boolean }>
> {
  const rows = await db
    .select({ unit: itemsTable.unit, count: sql<number>`count(*)` })
    .from(itemsTable)
    .where(eq(itemsTable.isActive, true))
    .groupBy(itemsTable.unit);
  const knownRows = await db.select({ name: unitsTable.name }).from(unitsTable);
  const known = new Set(knownRows.map((r) => r.name));
  return rows
    .map((r) => {
      const unit = String(r.unit ?? "").trim();
      return { unit, count: Number(r.count ?? 0), known: known.has(unit) };
    })
    .sort((a, b) => b.count - a.count);
}

/**
 * Unify one free-text unit into a standard unit across all items.
 * Records a sync change per affected item so peers converge.
 */
export async function normalizeUnit(from: string, to: string): Promise<number> {
  const source = from.trim();
  const target = to.trim();
  if (!source || !target || source === target) return 0;
  const node = await ensureNodeIdentity("web");
  const affected = await db.select().from(itemsTable).where(eq(itemsTable.unit, source));
  let count = 0;
  if (affected.length === 0) return 0;
  await db.transaction(async (tx) => {
    for (const row of affected) {
      const [updated] = await tx
        .update(itemsTable)
        .set({ unit: target, updatedAt: new Date() })
        .where(eq(itemsTable.id, row.id))
        .returning();
      if (!updated) continue;
      const globalId = await ensureEntityIdentity(tx, "item", updated.id);
      await recordLocalChange(tx, {
        nodeId: node.nodeId,
        entityType: "item",
        localEntityId: updated.id,
        globalId,
        changeType: "update",
        payload: {
          ...updated,
          categoryGlobalId: updated.categoryId
            ? await ensureEntityIdentity(tx, "category", updated.categoryId)
            : null,
        },
      });
      count += 1;
    }
  });
  return count;
}

/** Number of active items currently using a given unit string. */
export async function countItemsUsingUnit(unit: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(itemsTable)
    .where(eq(itemsTable.unit, unit));
  return Number(row?.count ?? 0);
}
