import { Router } from "express";
import { db, equipmentTable } from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { auditLog } from "../middlewares/audit";
import { runAlertWorker } from "../lib/alert-worker";
import { recordImportBatch } from "../lib/import-batches-service";
import { getEquipmentHistory } from "../lib/equipment-history-service";
import { eq, ne, and, ilike, or, sql, isNotNull } from "drizzle-orm";
import {
  ensureEntityIdentity,
  ensureNodeIdentity,
  recordLocalChange,
} from "../lib/sync-service";

const router = Router();

function isValidDateString(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function maintenanceDateError(sentAt: unknown, returnedAt: unknown): string | null {
  if (sentAt && !isValidDateString(sentAt)) return "تاريخ الإرسال للصيانة غير صالح";
  if (returnedAt && !isValidDateString(returnedAt)) return "تاريخ الإعادة من الصيانة غير صالح";
  if (typeof sentAt === "string" && typeof returnedAt === "string" && returnedAt < sentAt) {
    return "تاريخ الإعادة من الصيانة لا يمكن أن يسبق تاريخ الإرسال";
  }
  return null;
}

// GET /api/equipment
router.get("/", requireAuth, async (req, res) => {
  try {
    const {
      condition,
      search,
      page = "1",
      limit = "50",
      sortBy = "createdAt",
      sortDir = "desc",
    } = req.query as Record<string, string>;

    const pageNum = Math.max(1, parseInt(page, 10));
    // Catalog pickers request the complete catalog in one stable, sorted
    // list. Keep a generous safety cap without silently truncating normal
    // inventory catalogs.
    const limitNum = Math.min(5000, Math.max(1, parseInt(limit, 10)));
    const offset = (pageNum - 1) * limitNum;

    const SORT_COLS: Record<string, any> = {
      name: equipmentTable.name,
      condition: equipmentTable.condition,
      quantity: equipmentTable.quantity,
      manufactureYear: equipmentTable.manufactureYear,
      createdAt: equipmentTable.createdAt,
    };
    const sortCol = SORT_COLS[sortBy] ?? equipmentTable.createdAt;
    const dir = sortDir === "asc" ? "asc" : "desc";

    // Phase 1: archived equipment is hidden from every list/picker.
    const conditions = [eq(equipmentTable.isActive, true)];
    if (condition) conditions.push(eq(equipmentTable.condition, condition as never));
    if (search) {
      const pattern = `%${search}%`;
      conditions.push(
        or(
          ilike(equipmentTable.name, pattern),
          ilike(equipmentTable.model, pattern),
          ilike(equipmentTable.serialNumber, pattern),
          ilike(equipmentTable.equipmentType, pattern),
        )!
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [equipment, totalResult] = await Promise.all([
      db.query.equipmentTable.findMany({
        where,
        orderBy: dir === "asc" ? (_, { asc }) => [asc(sortCol)] : (_, { desc }) => [desc(sortCol)],
        limit: limitNum,
        offset,
      }),
      db
        .select({ count: sql<number>`count(*)` })
        .from(equipmentTable)
        .where(where),
    ]);

    res.json({
      equipment,
      total: Number(totalResult[0]?.count ?? 0),
      page: pageNum,
      limit: limitNum,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/equipment (definition - admin only, phase 1 governance)
router.post(
  "/",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const {
        code,
        name,
        equipmentType,
        model,
        serialNumber,
        condition = "good",
        manufactureYear,
        originCountry,
        currentHolder,
        notes,
        quantity,
        minQuantity,
        maintenanceSentAt,
        maintenanceReturnedAt,
        maintenanceNotes,
      } = req.body;
      if (!name) {
        res.status(400).json({ error: "name is required" });
        return;
      }
      const qty = quantity !== undefined ? parseInt(String(quantity), 10) : 1;
      const minQty = minQuantity !== undefined ? parseInt(String(minQuantity), 10) : 0;
      const finalQty = isNaN(qty) || qty < 1 ? 1 : qty;
      const sn = serialNumber ? String(serialNumber).trim() : null;
      const normalizedCode = code ? String(code).trim() : null;
      if (normalizedCode) {
        const [dup] = await db
          .select({ id: equipmentTable.id })
          .from(equipmentTable)
          .where(eq(equipmentTable.code, normalizedCode))
          .limit(1);
        if (dup) {
          res.status(409).json({ error: "رمز التجهيز مستخدم مسبقًا.", code: "EQUIPMENT_CODE_DUPLICATE" });
          return;
        }
      }
      const maintenanceError = maintenanceDateError(maintenanceSentAt, maintenanceReturnedAt);
      if (maintenanceError) {
        res.status(400).json({ error: maintenanceError });
        return;
      }

      // A serial number uniquely identifies one physical unit — quantity must be 1
      if (sn && finalQty > 1) {
        res.status(400).json({
          error: "التجهيزات ذات الرقم التسلسلي يجب أن تكون كميتها 1 فقط، لأن الرقم التسلسلي يعرّف جهازاً واحداً بعينه",
        });
        return;
      }

      const node = await ensureNodeIdentity("web");
      const eq_ = await db
        .transaction(async (tx) => {
          const [inserted] = await tx
            .insert(equipmentTable)
            .values({
              code: normalizedCode,
              name,
              equipmentType: equipmentType || null,
              model: model || null,
              serialNumber: sn,
              condition,
              manufactureYear: manufactureYear ? parseInt(manufactureYear, 10) : null,
              originCountry: originCountry || null,
              currentHolder: currentHolder || null,
              notes: notes || null,
              quantity: finalQty,
              minQuantity: isNaN(minQty) || minQty < 0 ? 0 : minQty,
              maintenanceSentAt: maintenanceSentAt || null,
              maintenanceReturnedAt: maintenanceReturnedAt || null,
              maintenanceNotes: maintenanceNotes || null,
            })
            .returning();
          const globalId = await ensureEntityIdentity(tx, "equipment", inserted.id);
          await recordLocalChange(tx, {
            nodeId: node.nodeId,
            entityType: "equipment",
            localEntityId: inserted.id,
            globalId,
            changeType: "create",
            payload: { ...inserted },
          });
          return inserted;
        });
      await auditLog({
        req,
        action: "create",
        entityType: "equipment",
        entityId: eq_.id,
        details: { name: eq_.name, quantity: eq_.quantity, serialNumber: eq_.serialNumber },
      });
      res.status(201).json(eq_);
      // Trigger alert worker so new equipment alerts are generated immediately
      runAlertWorker().catch((e) => console.error("Alert worker:", e));
    } catch (err: any) {
      if (err?.cause?.code === "23505" || err?.code === "23505") {
        res.status(409).json({ error: "الرقم التسلسلي مسجّل مسبقاً لتجهيز آخر في النظام" });
        return;
      }
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// POST /api/equipment/bulk-import (definition - admin only)
router.post(
  "/bulk-import",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const items = req.body;
      if (!Array.isArray(items) || items.length === 0) {
        res.status(400).json({ error: "يجب إرسال قائمة تجهيزات صالحة" });
        return;
      }
      if (items.length > 1000) {
        res.status(400).json({ error: "الحد الأقصى للاستيراد 1000 صف في المرة الواحدة" });
        return;
      }

      const VALID_CONDITIONS = new Set(["good", "maintenance", "broken", "consumed", "needs_inspection"]);
      const CONDITION_MAP: Record<string, string> = {
        "جيدة": "good", "جيد": "good",
        "في الصيانة": "maintenance", "صيانة": "maintenance",
        "معطلة": "broken", "معطل": "broken",
        "مستهلكة": "consumed", "مستهلك": "consumed",
        "تحتاج فحص": "needs_inspection", "يحتاج فحص": "needs_inspection",
      };

      const mode = (req.query.mode as string) === "upsert" ? "upsert" : "insert";

      // In upsert mode, pre-fetch existing serial numbers for insert-vs-update tracking
      const existingSerials = new Set<string>();
      if (mode === "upsert") {
        const existing = await db
          .select({ serialNumber: equipmentTable.serialNumber })
          .from(equipmentTable)
          .where(isNotNull(equipmentTable.serialNumber));
        existing.forEach((r) => { if (r.serialNumber) existingSerials.add(r.serialNumber); });
      }

      const results: {
        created: number;
        updated: number;
        errors: { row: number; name: string; error: string }[];
      } = { created: 0, updated: 0, errors: [] };
      const createdEquipmentIds: number[] = [];
      const updatedEquipmentIds: number[] = [];
      const updatedEquipmentSnapshots: Array<Record<string, unknown>> = [];
      const seenSerials = new Set<string>();

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const rowNum = i + 2;
        const name = String(item.name ?? "").trim();

        if (!name) {
          results.errors.push({ row: rowNum, name: `صف ${rowNum}`, error: "الاسم مطلوب" });
          continue;
        }

        // Resolve condition: accept Arabic label or English key
        let condition = String(item.condition ?? "good").trim();
        if (!VALID_CONDITIONS.has(condition)) {
          condition = CONDITION_MAP[condition] ?? "good";
        }

        const manufactureYear = item.manufactureYear
          ? parseInt(String(item.manufactureYear), 10)
          : null;
        if (item.manufactureYear && (isNaN(manufactureYear!) || manufactureYear! < 1900 || manufactureYear! > 2100)) {
          results.errors.push({ row: rowNum, name, error: "سنة الصنع غير صالحة" });
          continue;
        }

        const serialNumber = item.serialNumber ? String(item.serialNumber).trim() : null;
        const isUpdate = mode === "upsert" && serialNumber !== null && existingSerials.has(serialNumber);

        const rawQty = item.quantity !== undefined ? parseInt(String(item.quantity), 10) : 1;
        const rawMinQty = item.minQuantity !== undefined ? parseInt(String(item.minQuantity), 10) : 0;

        const values = {
          name,
          equipmentType: item.equipmentType ? String(item.equipmentType).trim() : null,
          model: item.model ? String(item.model).trim() : null,
          serialNumber,
          condition: condition as "good" | "maintenance" | "broken" | "consumed" | "needs_inspection",
          manufactureYear,
          originCountry: item.originCountry ? String(item.originCountry).trim() : null,
          currentHolder: item.currentHolder ? String(item.currentHolder).trim() : null,
          notes: item.notes ? String(item.notes).trim() : null,
          quantity: isNaN(rawQty) || rawQty < 1 ? 1 : rawQty,
          minQuantity: isNaN(rawMinQty) || rawMinQty < 0 ? 0 : rawMinQty,
        };

        try {
          if (mode === "upsert" && serialNumber !== null) {
            const [before] = await db
              .select()
              .from(equipmentTable)
              .where(eq(equipmentTable.serialNumber, serialNumber))
              .limit(1);
            if (before) {
              updatedEquipmentSnapshots.push({
                id: before.id,
                name: before.name,
                equipmentType: before.equipmentType,
                model: before.model,
                serialNumber: before.serialNumber,
                condition: before.condition,
                manufactureYear: before.manufactureYear,
                originCountry: before.originCountry,
                currentHolder: before.currentHolder,
                notes: before.notes,
                quantity: before.quantity,
                minQuantity: before.minQuantity,
              });
            }
            const inserted = await db
              .insert(equipmentTable)
              .values(values)
              .onConflictDoUpdate({
                target: equipmentTable.serialNumber,
                set: {
                  name: values.name,
                  equipmentType: values.equipmentType,
                  model: values.model,
                  condition: values.condition,
                  manufactureYear: values.manufactureYear,
                  originCountry: values.originCountry,
                  currentHolder: values.currentHolder,
                  notes: values.notes,
                  quantity: values.quantity,
                  minQuantity: values.minQuantity,
                },
              })
              .returning({ id: equipmentTable.id });
            if (isUpdate) {
              results.updated++;
              if (inserted[0]) updatedEquipmentIds.push(inserted[0].id);
            } else {
              results.created++;
              if (inserted[0]) createdEquipmentIds.push(inserted[0].id);
            }
          } else {
            const inserted = await db
              .insert(equipmentTable)
              .values(values)
              .returning({ id: equipmentTable.id });
            results.created++;
            if (inserted[0]) createdEquipmentIds.push(inserted[0].id);
          }
          seenSerials.add(serialNumber ?? "");
        } catch (err: unknown) {
          const e = err as { cause?: { code?: string }; code?: string };
          const isDuplicate = e?.cause?.code === "23505" || e?.code === "23505";
          results.errors.push({
            row: rowNum,
            name,
            error: isDuplicate ? "الرقم التسلسلي مستخدم مسبقاً — استخدم وضع «تحديث وإضافة» لتحديثه" : "خطأ في الإدراج",
          });
        }
      }

      await auditLog({
        req,
        action: "create",
        entityType: "equipment",
        details: {
          source: "bulk-import",
          mode,
          created: results.created,
          updated: results.updated,
          errors: results.errors.length,
        },
      });
      const batch = await recordImportBatch({
        kind: "equipment",
        mode,
        actorUserId: res.locals.user?.id ?? null,
        actorName: res.locals.user?.fullName ?? null,
        createdCount: results.created,
        updatedCount: results.updated,
        errorCount: results.errors.length,
        summary: { errors: results.errors.slice(0, 50) },
        rollback: {
          createdEquipment: createdEquipmentIds,
          updatedEquipment: updatedEquipmentSnapshots,
        },
      });
      res.json({ ...results, batchId: batch.id });
      // Trigger worker after import so equipment alerts are generated immediately
      runAlertWorker();
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// GET /api/equipment/:id
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const item = await db.query.equipmentTable.findFirst({
      where: (e, { eq: eqFn }) => eqFn(e.id, id),
    });
    if (!item) {
      res.status(404).json({ error: "Equipment not found" });
      return;
    }
    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/equipment/:id/history — equipment card, linked custodies, and movement history.
router.get("/:id/history", requireAuth, async (req, res) => {
  try {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid equipment id" });
      return;
    }

    const data = await getEquipmentHistory(id, {
      type: typeof req.query.type === "string" ? req.query.type : undefined,
      from: typeof req.query.from === "string" ? req.query.from : undefined,
      to: typeof req.query.to === "string" ? req.query.to : undefined,
      document: typeof req.query.document === "string" ? req.query.document : undefined,
    });
    if (!data) {
      res.status(404).json({ error: "Equipment not found" });
      return;
    }
    res.json(data);
  } catch (err) {
    console.error("[equipment-history]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /api/equipment/:id (definition - admin only)
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
        equipmentType,
        model,
        serialNumber,
        condition,
        manufactureYear,
        originCountry,
        currentHolder,
        notes,
        quantity,
        minQuantity,
        maintenanceSentAt,
        maintenanceReturnedAt,
        maintenanceNotes,
      } = req.body;

      const updates: Partial<typeof equipmentTable.$inferInsert> = {};
      if (name !== undefined) updates.name = name;
      if (code !== undefined) {
        const normalizedCode = code ? String(code).trim() : null;
        if (normalizedCode) {
          const [duplicate] = await db
            .select({ id: equipmentTable.id })
            .from(equipmentTable)
            .where(and(eq(equipmentTable.code, normalizedCode), ne(equipmentTable.id, id)))
            .limit(1);
          if (duplicate) {
            res.status(409).json({ error: "رمز التجهيز مستخدم مسبقًا.", code: "EQUIPMENT_CODE_DUPLICATE" });
            return;
          }
        }
        updates.code = normalizedCode;
      }
      if (equipmentType !== undefined) updates.equipmentType = equipmentType || null;
      if (model !== undefined) updates.model = model || null;
      if (serialNumber !== undefined) updates.serialNumber = serialNumber ? String(serialNumber).trim() : null;
      if (condition !== undefined) updates.condition = condition;
      if (manufactureYear !== undefined)
        updates.manufactureYear = manufactureYear ? parseInt(manufactureYear, 10) : null;
      if (originCountry !== undefined) updates.originCountry = originCountry || null;
      if (currentHolder !== undefined) updates.currentHolder = currentHolder || null;
      if (notes !== undefined) updates.notes = notes || null;
      // ── Balance is no longer editable from the metadata edit screen ────────
      // Approved plan §3: quantity changes must go through a documented
      // inventory adjustment movement. A same-value payload is tolerated so
      // legacy clients that resend the full record keep working.
      if (quantity !== undefined) {
        const requestedQty = parseInt(String(quantity), 10);
        const currentQty = await db.query.equipmentTable
          .findFirst({
            where: (e, { eq: eqFn }) => eqFn(e.id, id),
            columns: { quantity: true },
          })
          .then((row) => row?.quantity ?? null);
        if (
          currentQty !== null &&
          !Number.isNaN(requestedQty) &&
          requestedQty !== currentQty
        ) {
          res.status(409).json({
            error:
              "لا يمكن تعديل كمية التجهيز من شاشة البيانات؛ استخدم «تسوية الجرد» لإصدار سند حركة موثق",
            code: "EQUIPMENT_QUANTITY_NOT_EDITABLE",
          });
          return;
        }
        // Idempotent same-value payload: allowed, but never applied as a
        // balance write from this endpoint.
      }
      if (minQuantity !== undefined) {
        const minQty = parseInt(String(minQuantity), 10);
        updates.minQuantity = isNaN(minQty) || minQty < 0 ? 0 : minQty;
      }
      // Maintenance tracking fields
      if (maintenanceSentAt !== undefined) updates.maintenanceSentAt = maintenanceSentAt || null;
      if (maintenanceReturnedAt !== undefined) updates.maintenanceReturnedAt = maintenanceReturnedAt || null;
      if (maintenanceNotes !== undefined) updates.maintenanceNotes = maintenanceNotes || null;

      // Phase 4: field-level audit for equipment definitions.
      const [equipmentBefore] = await db
        .select()
        .from(equipmentTable)
        .where(eq(equipmentTable.id, id))
        .limit(1);
      const definitionChanges: Record<string, { before: unknown; after: unknown }> = {};
      if (equipmentBefore) {
        for (const [key, value] of Object.entries(updates)) {
          const prev = (equipmentBefore as Record<string, unknown>)[key];
          if (String(prev ?? "") !== String((value as unknown) ?? "")) {
            definitionChanges[key] = { before: prev ?? null, after: (value as unknown) ?? null };
          }
        }
      }

      const maintenanceError = maintenanceDateError(maintenanceSentAt, maintenanceReturnedAt);
      if (maintenanceError) {
        res.status(400).json({ error: maintenanceError });
        return;
      }

      // Determine effective serialNumber and quantity after merges
      if (updates.serialNumber !== undefined || updates.quantity !== undefined) {
        const current = await db.query.equipmentTable.findFirst({
          where: (e, { eq: eqFn }) => eqFn(e.id, id),
          columns: { serialNumber: true, quantity: true },
        });
        if (current) {
          const effectiveSN = updates.serialNumber !== undefined ? updates.serialNumber : current.serialNumber;
          const effectiveQty = updates.quantity !== undefined ? updates.quantity : current.quantity;
          if (effectiveSN && effectiveQty > 1) {
            res.status(400).json({
              error: "التجهيزات ذات الرقم التسلسلي يجب أن تكون كميتها 1 فقط، لأن الرقم التسلسلي يعرّف جهازاً واحداً بعينه",
            });
            return;
          }
        }
      }

      const node = await ensureNodeIdentity("web");
      const eq_ = await db
        .transaction(async (tx) => {
          const [updated] = await tx
            .update(equipmentTable)
            .set({ ...updates, updatedAt: new Date() })
            .where(eq(equipmentTable.id, id))
            .returning();
          if (!updated) return undefined;
          const globalId = await ensureEntityIdentity(tx, "equipment", updated.id);
          await recordLocalChange(tx, {
            nodeId: node.nodeId,
            entityType: "equipment",
            localEntityId: updated.id,
            globalId,
            changeType: "update",
            payload: { ...updated },
          });
          return updated;
        });

      if (!eq_) {
        res.status(404).json({ error: "Equipment not found" });
        return;
      }
      await auditLog({
        req,
        action: "update",
        entityType: "equipment",
        entityId: eq_.id,
        details: {
          changes: definitionChanges,
          name: eq_.name,
          condition: eq_.condition,
          quantity: eq_.quantity,
          serialNumber: eq_.serialNumber,
        },
      });
      res.json(eq_);
      runAlertWorker(); // re-evaluate: condition / minQuantity may have changed
    } catch (err: any) {
      if (err?.cause?.code === "23505" || err?.code === "23505") {
        res.status(409).json({ error: "الرقم التسلسلي مسجّل مسبقاً لتجهيز آخر في النظام" });
        return;
      }
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// DELETE /api/equipment/:id (archive - admin only)
router.delete(
  "/:id",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      const node = await ensureNodeIdentity("web");
      // Phase 1 governance: equipment is ARCHIVED (is_active = false), never
      // hard-deleted, so historical movements and custodies stay traceable.
      const deleted = await db.transaction(async (tx) => {
        const [removed] = await tx
          .update(equipmentTable)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(equipmentTable.id, id))
          .returning();
        if (!removed) return undefined;
        const globalId = await ensureEntityIdentity(tx, "equipment", removed.id);
        await recordLocalChange(tx, {
          nodeId: node.nodeId,
          entityType: "equipment",
          localEntityId: removed.id,
          globalId,
          changeType: "update",
          payload: { ...removed },
        });
        return removed;
      });

      if (!deleted) {
        res.status(404).json({ error: "التجهيز غير موجود" });
        return;
      }
      await auditLog({ req, action: "delete", entityType: "equipment", entityId: id, details: { name: deleted.name } });
      res.status(204).send();
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
