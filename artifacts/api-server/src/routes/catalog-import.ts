import { Router } from "express";
import {
  db,
  itemsTable,
  equipmentTable,
  unitsTable,
  categoriesTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth";
import { auditLog } from "../middlewares/audit";
import {
  type CatalogAnalysis,
  type CatalogEquipmentRow,
  type CatalogImportMode,
  type CatalogItemRow,
  type CatalogValidationContext,
  equipmentKey,
  itemKey,
  validateCatalogEquipmentRows,
  validateCatalogItemRows,
} from "@workspace/api-zod";
import {
  ensureEntityIdentity,
  ensureNodeIdentity,
  recordLocalChange,
} from "../lib/sync-service";

/**
 * Catalog import (materials + equipment definitions).
 *
 * Preview never writes; the commit path is atomic and can only touch catalog
 * definitions - balances, batches and movements are never modified here.
 */
const router = Router();

type CatalogPayload = {
  mode?: unknown;
  items?: unknown;
  equipment?: unknown;
};

function asRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

async function buildContext(mode: CatalogImportMode): Promise<CatalogValidationContext> {
  const unitRows = await db.select({ name: unitsTable.name }).from(unitsTable).where(eq(unitsTable.isActive, true));
  const categoryRows = await db.select({ name: categoriesTable.name }).from(categoriesTable);

  const itemRows = await db
    .select({ code: itemsTable.code, name: itemsTable.name, unit: itemsTable.unit })
    .from(itemsTable);
  const equipmentRows = await db
    .select({ serialNumber: equipmentTable.serialNumber, name: equipmentTable.name, model: equipmentTable.model })
    .from(equipmentTable);

  const existingItemKeys = new Set<string>();
  for (const row of itemRows) {
    if (row.code) existingItemKeys.add(`code:${row.code}`);
    else existingItemKeys.add(`name:${row.name}|unit:${row.unit}`);
  }
  const existingEquipmentKeys = new Set<string>();
  for (const row of equipmentRows) {
    if (row.serialNumber) existingEquipmentKeys.add(`serial:${row.serialNumber}`);
    else existingEquipmentKeys.add(`name:${row.name}|model:${row.model ?? ""}`);
  }

  return {
    knownUnits: new Set(unitRows.map((u) => u.name)),
    knownCategories: new Set(categoryRows.map((c) => c.name)),
    existingItemKeys,
    existingEquipmentKeys,
    mode,
  };
}

async function analyze(payload: CatalogPayload) {
  const mode: CatalogImportMode = payload.mode === "add-only" ? "add-only" : "add-and-update";
  const ctx = await buildContext(mode);
  const items = validateCatalogItemRows(asRows(payload.items), ctx);
  const equipment = validateCatalogEquipmentRows(asRows(payload.equipment), ctx);
  return { mode, items, equipment };
}

function summarize(analysis: { items: CatalogAnalysis<CatalogItemRow>; equipment: CatalogAnalysis<CatalogEquipmentRow> }) {
  return {
    items: analysis.items.summary,
    equipment: analysis.equipment.summary,
    totals: {
      create: analysis.items.summary.create + analysis.equipment.summary.create,
      update: analysis.items.summary.update + analysis.equipment.summary.update,
      skip: analysis.items.summary.skip + analysis.equipment.summary.skip,
      error: analysis.items.summary.error + analysis.equipment.summary.error,
    },
  };
}

// POST /api/catalog/import/preview - analysis only, never writes
router.post("/import/preview", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const analysis = await analyze(req.body ?? {});
    res.json({
      mode: analysis.mode,
      summary: summarize(analysis),
      items: analysis.items.rows,
      equipment: analysis.equipment.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "حدث خطأ غير متوقع في الخادم." });
  }
});

// POST /api/catalog/import - atomic commit of the catalog definitions
router.post("/import", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const analysis = await analyze(req.body ?? {});
    if (analysis.items.summary.error > 0 || analysis.equipment.summary.error > 0) {
      res.status(409).json({
        error: "لا يمكن التنفيذ مع وجود أخطاء في الملف. صحّح الأخطاء أو استخدم وضع المعاينة.",
        code: "CATALOG_IMPORT_HAS_ERRORS",
        summary: summarize(analysis),
      });
      return;
    }

    const categoryRows = await db.select({ id: categoriesTable.id, name: categoriesTable.name }).from(categoriesTable);
    const categoryByName = new Map(categoryRows.map((c) => [c.name, c.id]));
    const node = await ensureNodeIdentity("web");

    let createdItems = 0;
    let updatedItems = 0;
    let createdEquipment = 0;
    let updatedEquipment = 0;

    await db.transaction(async (tx) => {
      for (const decision of analysis.items.rows) {
        if (decision.action === "skip" || decision.action === "error") continue;
        const row = decision.data;
        const categoryId = row.category ? categoryByName.get(row.category) ?? null : null;

        if (decision.action === "create") {
          const [saved] = await tx
            .insert(itemsTable)
            .values({
              code: row.code,
              name: row.name,
              categoryId,
              itemType: "consumable",
              unit: row.unit,
              minStock: row.minStock,
              requiresBatchTracking: row.requiresBatch,
              requiresExpiryTracking: row.requiresExpiry,
              location: row.location,
              supplier: row.supplier,
              notes: row.notes,
              isActive: row.active,
            })
            .returning();
          if (!saved) continue;
          createdItems += 1;
          const globalId = await ensureEntityIdentity(tx, "item", saved.id);
          await recordLocalChange(tx, {
            nodeId: node.nodeId,
            entityType: "item",
            localEntityId: saved.id,
            globalId,
            changeType: "create",
            payload: { ...saved, categoryGlobalId: categoryId ? await ensureEntityIdentity(tx, "category", categoryId) : null },
          });
        } else {
          const existing = await tx
            .select()
            .from(itemsTable)
            .where(row.code ? eq(itemsTable.code, row.code) : and(eq(itemsTable.name, row.name), eq(itemsTable.unit, row.unit)))
            .limit(1);
          const target = existing[0];
          if (!target) continue;
          const [saved] = await tx
            .update(itemsTable)
            .set({
              name: row.name,
              categoryId,
              unit: row.unit,
              minStock: row.minStock,
              requiresBatchTracking: row.requiresBatch,
              requiresExpiryTracking: row.requiresExpiry,
              location: row.location,
              supplier: row.supplier,
              notes: row.notes,
              isActive: row.active,
              updatedAt: new Date(),
            })
            .where(eq(itemsTable.id, target.id))
            .returning();
          if (!saved) continue;
          updatedItems += 1;
          const globalId = await ensureEntityIdentity(tx, "item", saved.id);
          await recordLocalChange(tx, {
            nodeId: node.nodeId,
            entityType: "item",
            localEntityId: saved.id,
            globalId,
            changeType: "update",
            payload: { ...saved, categoryGlobalId: categoryId ? await ensureEntityIdentity(tx, "category", categoryId) : null },
          });
        }
      }

      for (const decision of analysis.equipment.rows) {
        if (decision.action === "skip" || decision.action === "error") continue;
        const row = decision.data;

        if (decision.action === "create") {
          const [saved] = await tx
            .insert(equipmentTable)
            .values({
              code: row.code,
              name: row.name,
              equipmentType: row.equipmentType,
              model: row.model,
              serialNumber: row.serialNumber,
              condition: "good",
              currentHolder: null,
              notes: [row.company ? `الشركة: ${row.company}` : null, row.notes].filter(Boolean).join(" | ") || null,
              quantity: 1,
              minQuantity: row.minQuantity,
              isActive: row.active,
            })
            .returning();
          if (!saved) continue;
          createdEquipment += 1;
          const globalId = await ensureEntityIdentity(tx, "equipment", saved.id);
          await recordLocalChange(tx, {
            nodeId: node.nodeId,
            entityType: "equipment",
            localEntityId: saved.id,
            globalId,
            changeType: "create",
            payload: { ...saved },
          });
        } else {
          const existing = await tx
            .select()
            .from(equipmentTable)
            .where(row.serialNumber ? eq(equipmentTable.serialNumber, row.serialNumber) : eq(equipmentTable.name, row.name))
            .limit(1);
          const target = existing[0];
          if (!target) continue;
          const [saved] = await tx
            .update(equipmentTable)
            .set({
              code: row.code,
              name: row.name,
              equipmentType: row.equipmentType,
              model: row.model,
              serialNumber: row.serialNumber,
              minQuantity: row.minQuantity,
              isActive: row.active,
              updatedAt: new Date(),
            })
            .where(eq(equipmentTable.id, target.id))
            .returning();
          if (!saved) continue;
          updatedEquipment += 1;
          const globalId = await ensureEntityIdentity(tx, "equipment", saved.id);
          await recordLocalChange(tx, {
            nodeId: node.nodeId,
            entityType: "equipment",
            localEntityId: saved.id,
            globalId,
            changeType: "update",
            payload: { ...saved },
          });
        }
      }
    });

    await auditLog({
      req,
      action: "catalog_import",
      entityType: "catalog",
      details: { mode: analysis.mode, createdItems, updatedItems, createdEquipment, updatedEquipment },
    });

    res.json({
      ok: true,
      mode: analysis.mode,
      createdItems,
      updatedItems,
      createdEquipment,
      updatedEquipment,
      skipped: summarize(analysis).totals.skip,
    });
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : "";
    res.status(400).json({ error: message || "تعذّر تنفيذ الاستيراد.", code: "CATALOG_IMPORT_FAILED" });
  }
});

export { itemKey, equipmentKey };
export default router;
