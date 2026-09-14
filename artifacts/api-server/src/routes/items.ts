import { Router } from "express";
import {
  db,
  inventoryBatchesTable,
  itemsTable,
  categoriesTable,
  systemSettingsTable,
  transactionsTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { auditLog } from "../middlewares/audit";
import { runAlertWorker } from "../lib/alert-worker";
import { recordImportBatch } from "../lib/import-batches-service";
import {
  ensureEntityIdentity,
  ensureNodeIdentity,
  recordLocalChange,
} from "../lib/sync-service";
import {
  allocateBatchesFefo,
  InventoryMovementError,
  type FefoBatch,
} from "../lib/inventory-movement-core";
import {
  createCategoryLookup,
  createUnitLookup,
  DEFAULT_INVENTORY_UNITS,
  INVENTORY_TEMPLATE_VERSION,
  normalizeHeader,
  validateInventoryOpeningBatchRows,
  validateInventoryImportRows,
} from "@workspace/api-zod";
import {
  getItemHistory,
  ITEM_HISTORY_TYPES,
  type ItemHistoryType,
} from "../lib/item-history-service";
import {
  createInventoryMovementInTransaction,
  movementContextFromRequest,
} from "../lib/inventory-movement-service";
import { eq, and, ne, ilike, or, lte, sql, isNotNull, asc, desc, type AnyColumn } from "drizzle-orm";

const router = Router();

function isValidIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseNonNegativeInteger(value: unknown, fallback: number) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function isUniqueViolation(error: unknown) {
  const candidate = error as { cause?: { code?: string }; code?: string };
  return candidate?.cause?.code === "23505" || candidate?.code === "23505";
}

type ImportInput = Record<string, unknown>;
type ImportAnalysis = {
  valid: boolean;
  summary: {
    totalRows: number;
    validRows: number;
    warningRows: number;
    errorRows: number;
    newItems: number;
    updatedItems: number;
    openingBatches: number;
  };
  itemRows: ReturnType<typeof validateInventoryImportRows>;
  openingBatchRows: ReturnType<typeof validateInventoryOpeningBatchRows>;
};

function importArrays(body: unknown) {
  if (Array.isArray(body)) {
    return { items: body.filter(isImportInput), openingBatches: [] as ImportInput[] };
  }
  const value = body as { items?: unknown; openingBatches?: unknown } | null;
  return {
    items: Array.isArray(value?.items) ? value.items.filter(isImportInput) : [],
    openingBatches: Array.isArray(value?.openingBatches)
      ? value.openingBatches.filter(isImportInput)
      : [],
  };
}

function isImportInput(value: unknown): value is ImportInput {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function analyzeImport(body: unknown, mode: "insert" | "upsert"): Promise<ImportAnalysis> {
  const { items, openingBatches } = importArrays(body);
  const [allCategories, existing, existingBatches] = await Promise.all([
    db.select({ id: categoriesTable.id, name: categoriesTable.name }).from(categoriesTable),
    db
      .select({
        id: itemsTable.id,
        code: itemsTable.code,
        name: itemsTable.name,
        requiresExpiryTracking: itemsTable.requiresExpiryTracking,
        requiresBatchTracking: itemsTable.requiresBatchTracking,
      })
      .from(itemsTable)
      .where(isNotNull(itemsTable.code)),
    db
      .select({
        code: itemsTable.code,
        batchNumber: inventoryBatchesTable.batchNumber,
        expiryDate: inventoryBatchesTable.expiryDate,
        deliveryNoteNumber: inventoryBatchesTable.deliveryNoteNumber,
      })
      .from(inventoryBatchesTable)
      .innerJoin(itemsTable, eq(inventoryBatchesTable.itemId, itemsTable.id))
      .where(isNotNull(itemsTable.code)),
  ]);
  const existingByCode = new Map(
    existing
      .filter((item) => item.code)
      .map((item) => [item.code!.trim(), item]),
  );
  const categories = createCategoryLookup(allCategories);
  const itemRows = validateInventoryImportRows(items, {
    mode,
    categories,
    existingByCode,
    units: createUnitLookup(DEFAULT_INVENTORY_UNITS),
  });

  // New materials are available by code to the second sheet during this
  // preflight, but are not written until the complete file passes validation.
  const projectedByCode = new Map(existingByCode);
  for (const decision of itemRows) {
    if (
      decision.state !== "error" &&
      decision.action === "create-item" &&
      decision.row.code
    ) {
      projectedByCode.set(decision.row.code, {
        id: -decision.row.rowNumber,
        code: decision.row.code,
        name: decision.row.name,
        requiresExpiryTracking: false,
        requiresBatchTracking: false,
      });
    }
  }
  const openingBatchRows = validateInventoryOpeningBatchRows(openingBatches, {
    existingByCode: projectedByCode,
    existingBatchKeys: new Set(existingBatches.map((batch) => [
      batch.code ?? "",
      batch.batchNumber ?? "",
      batch.expiryDate ?? "",
      batch.deliveryNoteNumber ?? "",
    ].join("|"))),
  });
  const allDecisions = [...itemRows, ...openingBatchRows];
  const errors = allDecisions.filter((decision) => decision.state === "error");
  const warnings = allDecisions.filter((decision) => decision.warnings.length > 0);
  const validRows = allDecisions.filter(
    (decision) => decision.state === "valid" || decision.state === "warning",
  );
  return {
    valid: errors.length === 0 && (itemRows.length > 0 || openingBatchRows.length > 0),
    summary: {
      totalRows: allDecisions.filter((decision) => decision.state !== "empty").length,
      validRows: validRows.length,
      warningRows: warnings.length,
      errorRows: errors.length,
      newItems: itemRows.filter((decision) => decision.action === "create-item").length,
      updatedItems: itemRows.filter((decision) => decision.action === "update-item").length,
      openingBatches: openingBatchRows.filter(
        (decision) => decision.action === "create-opening-batch",
      ).length + itemRows.filter(
        (decision) => decision.createsOpeningBatch && decision.action === "create-item",
      ).length,
    },
    itemRows,
    openingBatchRows,
  };
}

function serializeAnalysis(analysis: ImportAnalysis) {
  return {
    valid: analysis.valid,
    summary: analysis.summary,
    itemRows: analysis.itemRows.map((decision) => ({
      rowNumber: decision.row.rowNumber,
      state: decision.state,
      action: decision.action,
      row: decision.row,
      errors: decision.errors,
      warnings: decision.warnings,
    })),
    openingBatchRows: analysis.openingBatchRows.map((decision) => ({
      rowNumber: decision.row.rowNumber,
      state: decision.state,
      action: decision.action,
      row: decision.row,
      errors: decision.errors,
      warnings: decision.warnings,
    })),
  };
}

// GET /api/items
router.get("/", requireAuth, async (req, res) => {
  try {
    const {
      categoryId,
      search,
      belowMin,
      nearExpiry,
      page = "1",
      limit = "50",
      sortBy = "name",
      sortDir = "asc",
    } = req.query as Record<string, string>;

    const pageNum = Math.max(1, parseInt(page, 10));
    // Catalog pickers request the complete active catalog in one stable,
    // sorted list. Keep a generous safety cap without silently truncating
    // normal inventory catalogs.
    const limitNum = Math.min(5000, Math.max(1, parseInt(limit, 10)));
    const offset = (pageNum - 1) * limitNum;

    const conditions = [eq(itemsTable.isActive, true)];

    if (categoryId) conditions.push(eq(itemsTable.categoryId, parseInt(categoryId, 10)));
    if (search) {
      conditions.push(
        or(
          ilike(itemsTable.name, `%${search}%`),
          ilike(itemsTable.code, `%${search}%`),
          ilike(itemsTable.batchNumber, `%${search}%`),
          ilike(itemsTable.supplier, `%${search}%`)
        )!
      );
    }
    if (belowMin === "true") {
      conditions.push(
        and(
          sql`${itemsTable.minStock} > 0`,
          lte(itemsTable.currentStock, itemsTable.minStock),
        )!,
      );
    }
    if (nearExpiry === "true") {
      const settings = await db.query.systemSettingsTable.findFirst();
      const alertDays = settings?.expiryAlertDays ?? 30;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() + alertDays);
      const today = new Date().toISOString().split("T")[0];
      conditions.push(
        sql`${itemsTable.expiryDate} IS NOT NULL
          AND ${itemsTable.expiryDate} > ${today}
          AND ${itemsTable.expiryDate} <= ${cutoffDate.toISOString().split("T")[0]}`
      );
    }

    const where = and(...conditions);

    // Sort
    const allowedSortCols = ["name", "currentStock", "minStock", "expiryDate", "createdAt"] as const;
    type SortCol = (typeof allowedSortCols)[number];
    const col: SortCol = allowedSortCols.includes(sortBy as SortCol) ? (sortBy as SortCol) : "name";
    const direction = sortDir === "desc" ? "desc" : "asc";

    const colMap: Record<SortCol, AnyColumn> = {
      name: itemsTable.name,
      currentStock: itemsTable.currentStock,
      minStock: itemsTable.minStock,
      expiryDate: itemsTable.expiryDate,
      createdAt: itemsTable.createdAt,
    };

    const orderExpr = direction === "asc" ? asc(colMap[col]) : desc(colMap[col]);

    const [items, totalResult] = await Promise.all([
      db
        .select({
          id: itemsTable.id,
          code: itemsTable.code,
          name: itemsTable.name,
          categoryId: itemsTable.categoryId,
          categoryName: categoriesTable.name,
          itemType: itemsTable.itemType,
          unit: itemsTable.unit,
          currentStock: itemsTable.currentStock,
          minStock: itemsTable.minStock,
          expiryDate: itemsTable.expiryDate,
          batchNumber: itemsTable.batchNumber,
          location: itemsTable.location,
          supplier: itemsTable.supplier,
          notes: itemsTable.notes,
          isActive: itemsTable.isActive,
          createdAt: itemsTable.createdAt,
          updatedAt: itemsTable.updatedAt,
        })
        .from(itemsTable)
        .leftJoin(categoriesTable, eq(itemsTable.categoryId, categoriesTable.id))
        .where(where)
        .orderBy(orderExpr)
        .limit(limitNum)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)` })
        .from(itemsTable)
        .where(where),
    ]);

    res.json({
      items,
      total: Number(totalResult[0]?.count ?? 0),
      page: pageNum,
      limit: limitNum,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/items (definition - admin only, phase 1 governance)
router.post(
  "/",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const {
        code,
        name,
        categoryId,
        itemType,
        unit,
        currentStock = 0,
        minStock = 0,
        expiryDate,
        batchNumber,
        location,
        supplier,
        notes,
      } = req.body;
      const normalizedName = typeof name === "string" ? name.trim() : "";
      const normalizedCode = typeof code === "string" ? code.trim() : "";
      const normalizedUnit = typeof unit === "string" ? unit.trim() : "";
      const normalizedExpiryDate = typeof expiryDate === "string" ? expiryDate.trim() : "";

      if (normalizedName.length < 2 || !itemType || !normalizedUnit) {
        res.status(400).json({ error: "اسم المادة والوحدة والنوع حقول مطلوبة" });
        return;
      }
      const parsedStock = parseNonNegativeInteger(currentStock, 0);
      const parsedMinStock = parseNonNegativeInteger(minStock, 0);
      if (parsedStock === null) {
        res.status(400).json({ error: "الرصيد الافتتاحي يجب أن يكون عدداً صحيحاً غير سالب" });
        return;
      }
      if (parsedMinStock === null) {
        res.status(400).json({ error: "الحد الأدنى يجب أن يكون عدداً صحيحاً غير سالب" });
        return;
      }
      if (normalizedExpiryDate && !isValidIsoDate(normalizedExpiryDate)) {
        res.status(400).json({ error: "تاريخ الصلاحية غير صالح" });
        return;
      }
      if (normalizedCode) {
        const [duplicate] = await db
          .select({ id: itemsTable.id })
          .from(itemsTable)
          .where(eq(itemsTable.code, normalizedCode))
          .limit(1);
        if (duplicate) {
          res.status(409).json({ error: "رمز المادة مستخدم مسبقاً. اختر رمزاً آخر" });
          return;
        }
      }
      const parsedCategoryId = categoryId ? Number(categoryId) : null;
      if (parsedCategoryId !== null && (!Number.isSafeInteger(parsedCategoryId) || parsedCategoryId <= 0)) {
        res.status(400).json({ error: "التصنيف المحدد غير صالح" });
        return;
      }
      const node = await ensureNodeIdentity("web");
      const item = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(itemsTable)
          .values({
            code: normalizedCode || null,
            name: normalizedName,
            categoryId: parsedCategoryId,
            itemType,
            unit: normalizedUnit,
            currentStock: parsedStock,
            minStock: parsedMinStock,
            expiryDate: normalizedExpiryDate || null,
            batchNumber: typeof batchNumber === "string" ? batchNumber.trim() || null : null,
            location: typeof location === "string" ? location.trim() || null : null,
            supplier: typeof supplier === "string" ? supplier.trim() || null : null,
            notes: notes || null,
          })
          .returning();
        if (created.currentStock > 0) {
          const openingDate = new Date().toISOString().slice(0, 10);
          await tx.insert(inventoryBatchesTable).values({
            itemId: created.id,
            receivedQuantity: created.currentStock,
            remainingQuantity: created.currentStock,
            deliveryNoteNumber: `افتتاحي-${created.id}`,
            deliveryNoteDate: openingDate,
            supplySource: "central_warehouses",
          });
        }
        const globalId = await ensureEntityIdentity(tx, "item", created.id);
        await recordLocalChange(tx, {
          nodeId: node.nodeId,
          entityType: "item",
          localEntityId: created.id,
          globalId,
          changeType: "create",
          payload: {
            ...created,
            categoryGlobalId: created.categoryId
              ? await ensureEntityIdentity(tx, "category", created.categoryId)
              : null,
          },
        });
        // Opening batch travels as its own change so the receiver restores
        // both the stock balance and its FEFO batch.
        const createdBatches = await tx
          .select()
          .from(inventoryBatchesTable)
          .where(eq(inventoryBatchesTable.itemId, created.id));
        for (const batch of createdBatches) {
          const batchGlobalId = await ensureEntityIdentity(tx, "inventory_batch", batch.id);
          await recordLocalChange(tx, {
            nodeId: node.nodeId,
            entityType: "inventory_batch",
            localEntityId: batch.id,
            globalId: batchGlobalId,
            changeType: "create",
            payload: {
              ...batch,
              itemGlobalId: globalId,
            },
          });
        }
        return created;
      });
      await auditLog({ req, action: "create", entityType: "item", entityId: item.id, details: { name: item.name, itemType: item.itemType } });
      res.status(201).json(item);
    } catch (err) {
      console.error(err);
      if (isUniqueViolation(err)) {
        res.status(409).json({ error: "رمز المادة مستخدم مسبقاً. اختر رمزاً آخر" });
        return;
      }
      res.status(500).json({ error: "تعذر حفظ المادة حالياً" });
    }
  }
);

// POST /api/items/bulk-import/preview (definition - admin only)
router.post(
  "/bulk-import/preview",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const { items, openingBatches } = importArrays(req.body);
      if (items.length + openingBatches.length === 0) {
        res.status(400).json({ error: "يجب إرسال صفوف استيراد صالحة" });
        return;
      }
      if (items.length + openingBatches.length > 1000) {
        res.status(400).json({ error: "الحد الأقصى للاستيراد 1000 صف في المرة الواحدة" });
        return;
      }
      const mode = req.query.mode === "upsert" ? "upsert" : "insert";
      res.json(serializeAnalysis(await analyzeImport(req.body, mode)));
    } catch (error) {
      console.error(error);
      res.status(400).json({ error: "تعذر فحص ملف الاستيراد" });
    }
  },
);

// POST /api/items/bulk-import (definition - admin only)
router.post(
  "/bulk-import",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const { items, openingBatches } = importArrays(req.body);
      if (items.length + openingBatches.length === 0) {
        res.status(400).json({ error: "يجب إرسال صفوف استيراد صالحة" });
        return;
      }
      if (items.length + openingBatches.length > 1000) {
        res.status(400).json({ error: "الحد الأقصى للاستيراد 1000 صف في المرة الواحدة" });
        return;
      }
      const mode = req.query.mode === "upsert" ? "upsert" : "insert";
      const analysis = await analyzeImport(req.body, mode);
      if (!analysis.valid) {
        res.status(422).json({
          error: "لا يمكن تنفيذ الاستيراد قبل معالجة الأخطاء الحرجة",
          ...serializeAnalysis(analysis),
        });
        return;
      }

      const allCategories = await db
        .select({ id: categoriesTable.id, name: categoriesTable.name })
        .from(categoriesTable);
      const categoryMap = createCategoryLookup(allCategories);
      const context = movementContextFromRequest(req);
      const node = await ensureNodeIdentity("web");
      const openingDate = new Date().toISOString().slice(0, 10);
      const auditEvents: Array<{ action: "create" | "update"; id: number; name: string }> = [];
      const itemIdsByCode = new Map<string, number>();
      const createdItemIds: number[] = [];
      const updatedItemSnapshots: Array<Record<string, unknown>> = [];
      let created = 0;
      let updated = 0;
      let openingBatchCount = 0;

      await db.transaction(async (tx) => {
        for (const decision of analysis.itemRows) {
          if (decision.state === "empty") continue;
          const row = decision.row;
          const categoryId = row.categoryName
            ? categoryMap.get(normalizeHeader(row.categoryName)) ?? null
            : null;
          let saved;
          if (decision.action === "update-item" && decision.existingItem) {
            const [before] = await tx
              .select()
              .from(itemsTable)
              .where(eq(itemsTable.id, decision.existingItem.id))
              .limit(1);
            if (before) {
              updatedItemSnapshots.push({
                id: before.id,
                name: before.name,
                categoryId: before.categoryId,
                unit: before.unit,
                minStock: before.minStock,
                location: before.location,
                notes: before.notes,
              });
            }
            [saved] = await tx
              .update(itemsTable)
              .set({
                name: row.name,
                categoryId,
                unit: row.unit,
                minStock: row.minStock ?? 0,
                location: row.location,
                notes: row.notes,
                updatedAt: new Date(),
              })
              .where(eq(itemsTable.id, decision.existingItem.id))
              .returning();
            updated++;
            auditEvents.push({ action: "update", id: saved.id, name: saved.name });
          } else {
            [saved] = await tx
              .insert(itemsTable)
              .values({
                code: row.code,
                name: row.name,
                categoryId,
                itemType: "item",
                unit: row.unit,
                currentStock: 0,
                minStock: row.minStock ?? 0,
                location: row.location,
                notes: row.notes,
              })
              .returning();
            created++;
            createdItemIds.push(saved.id);
            auditEvents.push({ action: "create", id: saved.id, name: saved.name });
          }

          if (row.code) itemIdsByCode.set(row.code, saved.id);
          const globalId = await ensureEntityIdentity(tx, "item", saved.id);
          await recordLocalChange(tx, {
            nodeId: node.nodeId,
            entityType: "item",
            localEntityId: saved.id,
            globalId,
            changeType: decision.action === "update-item" ? "update" : "create",
            payload: { ...saved },
          });

          // An upsert is definition-only: a spreadsheet cannot silently alter
          // an existing balance or create a second opening batch.
          if (decision.createsOpeningBatch && decision.action === "create-item") {
            await createInventoryMovementInTransaction(tx, {
              kind: "in",
              itemType: "item",
              itemId: saved.id,
              quantity: row.currentStock,
              deliveryNoteNumber: `استيراد-افتتاحي-${saved.id}-${row.rowNumber}`,
              deliveryNoteDate: openingDate,
              documentDate: openingDate,
              supplySource: "central_warehouses",
              expiryDate: row.expiryDate,
              batchNumber: row.batchNumber,
              supplier: row.supplier,
              notes: row.notes,
            }, context, node);
            openingBatchCount++;
          }
        }

        for (const decision of analysis.openingBatchRows) {
          if (decision.state === "empty") continue;
          if (decision.skipExistingBatch || decision.action === "skip-existing-batch") continue;
          const itemId = decision.row.code ? itemIdsByCode.get(decision.row.code) : undefined;
          if (!itemId) throw new Error("IMPORT_ITEM_NOT_FOUND_AFTER_PREFLIGHT");
          await createInventoryMovementInTransaction(tx, {
            kind: "in",
            itemType: "item",
            itemId,
            quantity: decision.row.quantity,
            deliveryNoteNumber: decision.row.deliveryNoteNumber ?? `استيراد-دفعة-${itemId}-${decision.row.rowNumber}`,
            deliveryNoteDate: decision.row.deliveryNoteDate ?? openingDate,
            documentDate: decision.row.deliveryNoteDate ?? openingDate,
            supplySource: "central_warehouses",
            expiryDate: decision.row.expiryDate,
            batchNumber: decision.row.batchNumber,
            supplier: decision.row.supplier,
          }, context, node);
          openingBatchCount++;
        }
      });

      await Promise.all(auditEvents.map((event) =>
        auditLog({
          req,
          action: event.action,
          entityType: "item",
          entityId: event.id,
          details: { name: event.name, source: "bulk-import" },
        }),
      ));
      const batch = await recordImportBatch({
        kind: "items",
        mode,
        actorUserId: res.locals.user?.id ?? null,
        actorName: res.locals.user?.fullName ?? null,
        createdCount: created,
        updatedCount: updated,
        openingBatchCount,
        summary: analysis.summary,
        rollback: { createdItems: createdItemIds, updatedItems: updatedItemSnapshots },
      });

      res.json({
        batchId: batch.id,
        created,
        updated,
        openingBatches: openingBatchCount,
        inserted: created,
        skipped: 0,
        errors: [],
        warnings: [
          ...analysis.itemRows.flatMap((decision) =>
            decision.warnings.map((warning) => ({
              row: decision.row.rowNumber,
              name: decision.row.name,
              warning: warning.message,
            })),
          ),
          ...analysis.openingBatchRows.flatMap((decision) =>
            decision.warnings.map((warning) => ({
              row: decision.row.rowNumber,
              name: decision.row.code ?? `صف ${decision.row.rowNumber}`,
              warning: warning.message,
            })),
          ),
        ],
        summary: analysis.summary,
      });
      runAlertWorker().catch((error) => console.error("Alert worker:", error));
    } catch (error) {
      console.error(error);
      if (isUniqueViolation(error)) {
        res.status(409).json({ error: "يوجد رمز أو دفعة مكررة؛ لم يتم حفظ أي صف" });
        return;
      }
      res.status(500).json({ error: "تعذر تنفيذ الاستيراد؛ لم يتم حفظ أي صف" });
    }
  },
);

// GET /api/items/export
router.get(
  "/export",
  requireAuth,
  requireRole("admin", "warehouse_manager"),
  async (_req, res) => {
    try {
      const [items, batches] = await Promise.all([
        db
          .select({
            code: itemsTable.code,
            name: itemsTable.name,
            unit: itemsTable.unit,
            categoryId: itemsTable.categoryId,
            minStock: itemsTable.minStock,
            location: itemsTable.location,
            notes: itemsTable.notes,
          })
          .from(itemsTable)
          .where(eq(itemsTable.isActive, true)),
        db
          .select({
            code: itemsTable.code,
            quantity: inventoryBatchesTable.remainingQuantity,
            batchNumber: inventoryBatchesTable.batchNumber,
            expiryDate: inventoryBatchesTable.expiryDate,
            supplier: inventoryBatchesTable.supplier,
            deliveryNoteNumber: inventoryBatchesTable.deliveryNoteNumber,
            deliveryNoteDate: inventoryBatchesTable.deliveryNoteDate,
          })
          .from(inventoryBatchesTable)
          .innerJoin(itemsTable, eq(inventoryBatchesTable.itemId, itemsTable.id))
          .where(eq(itemsTable.isActive, true)),
      ]);
      const categoryRows = await db
        .select({ id: categoriesTable.id, name: categoriesTable.name })
        .from(categoriesTable);
      const categoryById = new Map(categoryRows.map((category) => [category.id, category.name]));
      res.json({
        version: INVENTORY_TEMPLATE_VERSION,
        exportedAt: new Date().toISOString(),
        items: items.map((item) => ({
          code: item.code ?? "",
          name: item.name,
          unit: item.unit,
          categoryName: item.categoryId ? categoryById.get(item.categoryId) ?? "" : "",
          minStock: item.minStock,
          location: item.location ?? "",
          notes: item.notes ?? "",
        })),
        openingBatches: batches
          .filter((batch) => Number(batch.quantity) > 0)
          .map((batch) => ({
            code: batch.code ?? "",
            quantity: batch.quantity,
            batchNumber: batch.batchNumber ?? "",
            expiryDate: batch.expiryDate ?? "",
            supplier: batch.supplier ?? "",
            deliveryNoteNumber: batch.deliveryNoteNumber ?? "",
            deliveryNoteDate: batch.deliveryNoteDate ?? "",
          })),
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "تعذر تصدير بيانات المخزون" });
    }
  },
);

// GET /api/items/fefo-preview
router.get("/fefo-preview", requireAuth, async (req, res) => {
  try {
    const id = Number.parseInt(String(req.query.itemId ?? ""), 10);
    const quantity = Number.parseInt(String(req.query.quantity ?? ""), 10);
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid item id" });
      return;
    }
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      res.status(400).json({ error: "الكمية يجب أن تكون عددًا صحيحًا أكبر من الصفر" });
      return;
    }

    const [item] = await db
      .select({
        id: itemsTable.id,
        itemType: itemsTable.itemType,
        currentStock: itemsTable.currentStock,
      })
      .from(itemsTable)
      .where(and(eq(itemsTable.id, id), eq(itemsTable.isActive, true)));

    if (!item) {
      res.status(404).json({ error: "Item not found" });
      return;
    }
    if (item.itemType !== "item") {
      res.status(400).json({ error: "معاينة FEFO متاحة للمواد المستهلكة فقط" });
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const batches = await db
      .select({
        id: inventoryBatchesTable.id,
        remainingQuantity: inventoryBatchesTable.remainingQuantity,
        expiryDate: inventoryBatchesTable.expiryDate,
        batchNumber: inventoryBatchesTable.batchNumber,
      })
      .from(inventoryBatchesTable)
      .where(
        and(
          eq(inventoryBatchesTable.itemId, id),
          sql`${inventoryBatchesTable.remainingQuantity} > 0`,
        ),
      )
      .orderBy(sql`${inventoryBatchesTable.expiryDate} ASC NULLS LAST`, asc(inventoryBatchesTable.id));

    const normalizedBatches: FefoBatch[] = batches.map((batch) => ({
      id: batch.id,
      remainingQuantity: batch.remainingQuantity,
      expiryDate: batch.expiryDate,
      batchNumber: batch.batchNumber,
    }));
    const eligibleBatches = normalizedBatches.filter(
      (batch) => !batch.expiryDate || batch.expiryDate >= today,
    );
    const expiredBatches = normalizedBatches.filter(
      (batch) => Boolean(batch.expiryDate && batch.expiryDate < today),
    );
    const availableQuantity = eligibleBatches.reduce(
      (total, batch) => total + batch.remainingQuantity,
      0,
    );

    let allocations: ReturnType<typeof allocateBatchesFefo> = [];
    let canFulfill = false;
    try {
      allocations = allocateBatchesFefo(normalizedBatches, quantity, today);
      canFulfill = true;
    } catch (error) {
      if (
        !(error instanceof InventoryMovementError) ||
        error.code !== "INSUFFICIENT_BATCH_STOCK"
      ) {
        throw error;
      }
    }

    res.json({
      itemId: item.id,
      itemStock: item.currentStock,
      requestedQuantity: quantity,
      availableQuantity,
      canFulfill,
      allocations: allocations.map((allocation) => ({
        batchId: allocation.batchId,
        quantity: allocation.quantity,
        batchNumber: allocation.batchNumberSnap,
        expiryDate: allocation.expiryDateSnap,
      })),
      expiredBatches: expiredBatches.map((batch) => ({
        batchId: batch.id,
        remainingQuantity: batch.remainingQuantity,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/items/history?itemId=ID
router.get("/history", requireAuth, async (req, res) => {
  try {
    const id = Number.parseInt(String(req.query.itemId ?? ""), 10);
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid item id" });
      return;
    }

    const type =
      typeof req.query.type === "string" && req.query.type
        ? req.query.type
        : undefined;
    if (type && !ITEM_HISTORY_TYPES.includes(type as ItemHistoryType)) {
      res.status(400).json({ error: "نوع الحركة غير صالح" });
      return;
    }

    const parseDateFilter = (value: unknown) => {
      if (value === undefined || value === "") return undefined;
      const normalized = String(value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
      return normalized;
    };
    const from = parseDateFilter(req.query.from);
    const to = parseDateFilter(req.query.to);
    if (from === null || to === null) {
      res.status(400).json({ error: "صيغة التاريخ يجب أن تكون YYYY-MM-DD" });
      return;
    }

    const result = await getItemHistory(id, {
      type: type as ItemHistoryType | undefined,
      from,
      to,
      document:
        typeof req.query.document === "string" ? req.query.document.trim() : undefined,
      page: Number.parseInt(String(req.query.page ?? "1"), 10) || 1,
      limit: Number.parseInt(String(req.query.limit ?? "20"), 10) || 20,
    });
    if (!result) {
      res.status(404).json({ error: "Item not found" });
      return;
    }
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid item id" }); return; }
    const [item] = await db
      .select({
        id: itemsTable.id,
        code: itemsTable.code,
        name: itemsTable.name,
        categoryId: itemsTable.categoryId,
        categoryName: categoriesTable.name,
        itemType: itemsTable.itemType,
        unit: itemsTable.unit,
        currentStock: itemsTable.currentStock,
        minStock: itemsTable.minStock,
        expiryDate: itemsTable.expiryDate,
        batchNumber: itemsTable.batchNumber,
        location: itemsTable.location,
        supplier: itemsTable.supplier,
        notes: itemsTable.notes,
        isActive: itemsTable.isActive,
        createdAt: itemsTable.createdAt,
        updatedAt: itemsTable.updatedAt,
      })
      .from(itemsTable)
      .leftJoin(categoriesTable, eq(itemsTable.categoryId, categoriesTable.id))
      .where(and(eq(itemsTable.id, id), eq(itemsTable.isActive, true)));

    if (!item) {
      res.status(404).json({ error: "Item not found" });
      return;
    }
    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /api/items/:id (definition - admin only)
router.put(
  "/:id",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      const {
        code,
        name,
        categoryId,
        itemType,
        unit,
        minStock,
        expiryDate,
        batchNumber,
        location,
        supplier,
        notes,
      } = req.body;

      if (!Number.isSafeInteger(id) || id <= 0) {
        res.status(400).json({ error: "معرّف المادة غير صالح" });
        return;
      }

      // Governance (phase 1): an item that already has movements keeps its
      // identity fields stable - changing code/unit would break historical
      // traceability. Create a new catalog item instead.
      if (code !== undefined || unit !== undefined) {
        const [existing] = await db
          .select({ code: itemsTable.code, unit: itemsTable.unit })
          .from(itemsTable)
          .where(eq(itemsTable.id, id))
          .limit(1);
        if (existing) {
          const [movement] = await db
            .select({ id: transactionsTable.id })
            .from(transactionsTable)
            .where(eq(transactionsTable.itemId, id))
            .limit(1);
          if (movement) {
            const nextCode = code !== undefined ? (String(code ?? "").trim() || null) : existing.code;
            const nextUnit = unit !== undefined ? (String(unit ?? "").trim() || null) : existing.unit;
            if (nextCode !== existing.code || nextUnit !== existing.unit) {
              res.status(409).json({
                error: "لا يمكن تغيير رمز أو وحدة صنف له حركات مسجّلة. أنشئ صنفًا جديدًا بدلًا من ذلك.",
                code: "ITEM_IDENTITY_LOCKED",
              });
              return;
            }
          }
        }
      }

      const updates: Partial<typeof itemsTable.$inferInsert> = {};
      const normalizedCode = typeof code === "string" ? code.trim() : "";
      const normalizedName = typeof name === "string" ? name.trim() : "";
      const normalizedUnit = typeof unit === "string" ? unit.trim() : "";
      const normalizedExpiryDate = typeof expiryDate === "string" ? expiryDate.trim() : "";

      if (name !== undefined) {
        if (normalizedName.length < 2) {
          res.status(400).json({ error: "اسم المادة مطلوب ويجب أن يكون حرفين على الأقل" });
          return;
        }
        updates.name = normalizedName;
      }
      if (code !== undefined) {
        if (normalizedCode) {
          const [duplicate] = await db
            .select({ id: itemsTable.id })
            .from(itemsTable)
            .where(and(eq(itemsTable.code, normalizedCode), ne(itemsTable.id, id)))
            .limit(1);
          if (duplicate) {
            res.status(409).json({ error: "رمز المادة مستخدم مسبقاً. اختر رمزاً آخر" });
            return;
          }
        }
        updates.code = normalizedCode || null;
      }
      if (categoryId !== undefined) {
        const parsedCategoryId = categoryId ? Number(categoryId) : null;
        if (parsedCategoryId !== null && (!Number.isSafeInteger(parsedCategoryId) || parsedCategoryId <= 0)) {
          res.status(400).json({ error: "التصنيف المحدد غير صالح" });
          return;
        }
        updates.categoryId = parsedCategoryId;
      }
      if (itemType !== undefined) updates.itemType = itemType;
      if (unit !== undefined) {
        if (!normalizedUnit) {
          res.status(400).json({ error: "الوحدة مطلوبة" });
          return;
        }
        updates.unit = normalizedUnit;
      }
      if (minStock !== undefined) {
        const parsedMinStock = parseNonNegativeInteger(minStock, 0);
        if (parsedMinStock === null) {
          res.status(400).json({ error: "الحد الأدنى يجب أن يكون عدداً صحيحاً غير سالب" });
          return;
        }
        updates.minStock = parsedMinStock;
      }
      if (expiryDate !== undefined) {
        if (normalizedExpiryDate && !isValidIsoDate(normalizedExpiryDate)) {
          res.status(400).json({ error: "تاريخ الصلاحية غير صالح" });
          return;
        }
        updates.expiryDate = normalizedExpiryDate || null;
      }
      if (batchNumber !== undefined) updates.batchNumber = typeof batchNumber === "string" ? batchNumber.trim() || null : null;
      if (location !== undefined) updates.location = typeof location === "string" ? location.trim() || null : null;
      if (supplier !== undefined) updates.supplier = typeof supplier === "string" ? supplier.trim() || null : null;
      if (notes !== undefined) updates.notes = typeof notes === "string" ? notes.trim() || null : null;

      // Phase 4: field-level audit - capture exactly which definition fields
      // changed (before/after) so the audit log is reviewable.
      const [itemBefore] = await db
        .select()
        .from(itemsTable)
        .where(eq(itemsTable.id, id))
        .limit(1);
      const definitionChanges: Record<string, { before: unknown; after: unknown }> = {};
      if (itemBefore) {
        for (const [key, value] of Object.entries(updates)) {
          const prev = (itemBefore as Record<string, unknown>)[key];
          if (String(prev ?? "") !== String((value as unknown) ?? "")) {
            definitionChanges[key] = { before: prev ?? null, after: (value as unknown) ?? null };
          }
        }
      }

      const node = await ensureNodeIdentity("web");
      const item = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(itemsTable)
          .set({ ...updates, updatedAt: new Date() })
          .where(eq(itemsTable.id, id))
          .returning();
        if (!updated) return undefined;
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
        return updated;
      });

      if (!item) {
        res.status(404).json({ error: "Item not found" });
        return;
      }
      await auditLog({
      req,
      action: "update",
      entityType: "item",
      entityId: item.id,
      details: { name: item.name, changes: definitionChanges },
    });
      res.json(item);
      runAlertWorker().catch((e) => console.error("Alert worker:", e));
    } catch (err) {
      console.error(err);
      if (isUniqueViolation(err)) {
        res.status(409).json({ error: "رمز المادة مستخدم مسبقاً. اختر رمزاً آخر" });
        return;
      }
      res.status(500).json({ error: "تعذر حفظ تعديلات المادة حالياً" });
    }
  }
);

// DELETE /api/items/:id (soft delete)
router.delete(
  "/:id",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      if (isNaN(id)) { res.status(400).json({ error: "Invalid item id" }); return; }
      const node = await ensureNodeIdentity("web");
      const deleted = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(itemsTable)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(itemsTable.id, id))
          .returning();
        if (!updated) return undefined;
        const globalId = await ensureEntityIdentity(tx, "item", updated.id);
        await recordLocalChange(tx, {
          nodeId: node.nodeId,
          entityType: "item",
          localEntityId: updated.id,
          globalId,
          changeType: "delete",
          payload: {
            ...updated,
            categoryGlobalId: updated.categoryId
              ? await ensureEntityIdentity(tx, "category", updated.categoryId)
              : null,
          },
        });
        return updated;
      });
      if (!deleted) {
        res.status(404).json({ error: "Item not found" });
        return;
      }
      await auditLog({ req, action: "delete", entityType: "item", entityId: id, details: {} });
      res.status(204).send();
      runAlertWorker().catch((e) => console.error("Alert worker:", e));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
