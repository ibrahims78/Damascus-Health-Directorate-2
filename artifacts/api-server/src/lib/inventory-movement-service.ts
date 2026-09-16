import { randomUUID } from "node:crypto";
import {
  auditLogTable,
  centralReturnsTable,
  custodyReturnsTable,
  db,
  damageRecordsTable,
  equipmentTable,
  exitReasonsTable,
  inventoryBatchesTable,
  itemsTable,
  personalCustodiesTable,
  recipientsTable,
  systemSettingsTable,
  transactionBatchAllocationsTable,
  transactionsTable,
  type TransactionType,
} from "@workspace/db";
import { DELIVERY_DESTINATIONS } from "@workspace/db";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Request } from "express";
import {
  allocateBatchesFefo,
  assertEntityReference,
  assertIsoDate,
  assertMeaningfulReason,
  assertNonEmpty,
  assertPositiveInteger,
  calculateEquipmentAvailable,
  InventoryMovementError,
  type FefoBatch,
} from "./inventory-movement-core";
import {
  ensureEntityIdentity,
  ensureNodeIdentity,
  recordLocalChange,
  reserveOriginSequence,
} from "./sync-service";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const DEFAULT_RETURN_CONDITION_BEHAVIORS = new Map([
  ["good", "good"],
  ["damaged", "damaged"],
  ["needs_maintenance", "needs_maintenance"],
  ["missing", "missing"],
]);

async function resolveReturnCondition(
  tx: DbTransaction,
  value: string,
) {
  const settings = await tx.query.systemSettingsTable.findFirst({
    columns: { returnConditions: true },
  });
  try {
    const parsed = settings?.returnConditions ? JSON.parse(settings.returnConditions) : [];
    const configured = Array.isArray(parsed) ? parsed.find((item) => item?.key === value) : null;
    const behavior = configured?.behavior ?? DEFAULT_RETURN_CONDITION_BEHAVIORS.get(value);
    if (typeof behavior === "string" && DEFAULT_RETURN_CONDITION_BEHAVIORS.has(behavior)) {
      return { key: value, behavior: behavior as "good" | "damaged" | "needs_maintenance" | "missing" };
    }
  } catch {
    // Fall through to the stable legacy keys.
  }
  throw new InventoryMovementError("INVALID_RETURN_CONDITION", "حالة الإعادة غير صالحة");
}

export type MovementContext = {
  userId: number;
  userName: string | null;
  ipAddress: string | null;
};

export type MovementInput = {
  kind:
    | "in"
    | "out"
    | "adjust"
    | "custody_out"
    | "custody_return"
    | "damage"
    | "central_return";
  itemType?: unknown;
  itemId?: unknown;
  equipmentId?: unknown;
  quantity?: unknown;
  recipientId?: unknown;
  recipientPerson?: unknown;
  exitReasonId?: unknown;
  deliveryNoteNumber?: unknown;
  deliveryNoteDate?: unknown;
  documentDate?: unknown;
  supplySource?: unknown;
  expiryDate?: unknown;
  batchNumber?: unknown;
  supplier?: unknown;
  internalDeliveryNoteNumber?: unknown;
  internalDeliveryNoteDate?: unknown;
  deliveryDestination?: unknown;
  custody?: unknown;
  holderName?: unknown;
  custodyNoteNumber?: unknown;
  custodyDate?: unknown;
  custodyLocation?: unknown;
  custodyId?: unknown;
  returnCondition?: unknown;
  returnedToLocation?: unknown;
  inspectionNotes?: unknown;
  damageDate?: unknown;
  serialNumber?: unknown;
  reason?: unknown;
  notes?: unknown;
  newStock?: unknown;
  /** Phase 6: explicit site for transfers (defaults to the current one). */
  warehouseId?: unknown;
};

const today = () => new Date().toISOString().slice(0, 10);

function textOrNull(value: unknown): string | null {
  const valueAsText = String(value ?? "").trim();
  return valueAsText || null;
}

function assertDeliveryDestination(
  value: unknown,
): "administrative_building" | "health_facility" | "ambulance_point" {
  const destination = assertNonEmpty(value, "جهة التسليم");
  if (!DELIVERY_DESTINATIONS.includes(destination as (typeof DELIVERY_DESTINATIONS)[number])) {
    throw new InventoryMovementError(
      "INVALID_DELIVERY_DESTINATION",
      "جهة التسليم يجب أن تكون مبنى إداريًا أو مرفقًا صحيًا",
    );
  }
  return destination as "administrative_building" | "health_facility" | "ambulance_point";
}

function parseOptionalId(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const normalized = String(value).trim();
  const parsed = /^\d+$/.test(normalized) ? Number(normalized) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new InventoryMovementError("INVALID_REFERENCE", "مرجع الصنف غير صالح");
  }
  return parsed;
}

function getContext(req: Request): MovementContext {
  const user = req.res?.locals?.user as
    | { id?: number; fullName?: string }
    | undefined;
  if (!user?.id) {
    throw new InventoryMovementError("UNAUTHORIZED", "يجب تسجيل الدخول", 401);
  }
  return {
    userId: user.id,
    userName: user.fullName ?? null,
    ipAddress:
      (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
      req.socket.remoteAddress ??
      null,
  };
}

export function movementContextFromRequest(req: Request): MovementContext {
  return getContext(req);
}

async function writeAudit(
  tx: DbTransaction,
  context: MovementContext,
  action: string,
  entityId: number | null,
  details: Record<string, unknown>,
) {
  await tx.insert(auditLogTable).values({
    userId: context.userId,
    userNameSnap: context.userName,
    action,
    entityType: "transaction",
    entityId,
    details,
    ipAddress: context.ipAddress,
  });
}

async function lockDocumentNumber(
  tx: DbTransaction,
  type: TransactionType,
): Promise<string> {
  const year = new Date().getFullYear();
  const prefix =
    type === "in"
      ? "IN"
      : type === "out"
        ? "OUT"
        : type === "custody_out"
          ? "CUST"
          : type === "custody_return"
            ? "CUST-RET"
            : type === "damage"
              ? "DMG"
              : type === "central_return"
                ? "RET"
                : "ADJ";

  // Phase 5: prefer the per-warehouse sequence so document numbers stay
  // globally unique across sites. Falls back to the legacy counter when the
  // warehouse model has not been initialised yet.
  try {
    const whRes = await tx.execute(sql`
      SELECT w.id AS id, w.code AS code
      FROM warehouses w
      LEFT JOIN system_settings s ON s.warehouse_id = w.id
      ORDER BY (s.id IS NOT NULL) DESC, (w.type = 'central') DESC, w.id
      LIMIT 1
    `);
    const wh = whRes.rows[0] as { id?: number; code?: string } | undefined;
    if (wh?.id) {
      const seq = await tx.execute(sql`
        INSERT INTO document_sequences (warehouse_id, doc_type, year, last_number)
        VALUES (${Number(wh.id)}, ${prefix}, ${year}, 1)
        ON CONFLICT (warehouse_id, doc_type, year)
        DO UPDATE SET last_number = document_sequences.last_number + 1, updated_at = now()
        RETURNING last_number
      `);
      const n = Number((seq.rows[0] as { last_number?: number } | undefined)?.last_number ?? 1);
      return `${String(wh.code)}-${prefix}-${year}-${String(n).padStart(6, "0")}`;
    }
  } catch {
    // fall through to the legacy numbering
  }

  // All movement types use the same advisory-lock namespace. This prevents
  // two requests from observing the same count before either inserts.
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`inventory-document-${year}-${type}`}))`,
  );
  const result = await tx.execute(sql`
    SELECT count(*)::int AS count
    FROM transactions
    WHERE type = ${type}
      AND extract(year FROM created_at) = ${year}
  `);
  const count = Number((result.rows[0] as { count?: number | string } | undefined)?.count ?? 0);
  return `${prefix}-${year}-${String(count + 1).padStart(4, "0")}`;
}

async function currentWarehouseId(tx: DbTransaction): Promise<number | null> {
  try {
    const res = await tx.execute(sql`
      SELECT w.id AS id
      FROM warehouses w
      LEFT JOIN system_settings s ON s.warehouse_id = w.id
      ORDER BY (s.id IS NOT NULL) DESC, (w.type = 'central') DESC, w.id
      LIMIT 1
    `);
    const row = res.rows[0] as { id?: number } | undefined;
    return row?.id ? Number(row.id) : null;
  } catch {
    return null;
  }
}

async function lockItem(tx: DbTransaction, itemId: number) {
  const result = await tx.execute(sql`
    SELECT id, name, item_type, current_stock
    FROM items
    WHERE id = ${itemId}
    FOR UPDATE
  `);
  const item = result.rows[0] as
    | { id: number; name: string; item_type: string; current_stock: number }
    | undefined;
  if (!item) {
    throw new InventoryMovementError("ITEM_NOT_FOUND", "المادة غير موجودة", 404);
  }
  return item;
}

async function lockEquipment(tx: DbTransaction, equipmentId: number) {
  const result = await tx.execute(sql`
    SELECT id, name, quantity, condition, serial_number, current_holder, model
    FROM equipment
    WHERE id = ${equipmentId}
    FOR UPDATE
  `);
  const equipment = result.rows[0] as
    | {
        id: number;
        name: string;
        quantity: number;
        condition: string;
        serial_number: string | null;
        current_holder: string | null;
        model: string | null;
      }
    | undefined;
  if (!equipment) {
    throw new InventoryMovementError("EQUIPMENT_NOT_FOUND", "التجهيز غير موجود", 404);
  }
  return equipment;
}

async function getOpenCustodyQuantity(
  tx: DbTransaction,
  equipmentId: number,
): Promise<number> {
  const result = await tx.execute(sql`
    SELECT coalesce(sum(quantity - returned_quantity), 0)::int AS quantity
    FROM personal_custodies
    WHERE equipment_id = ${equipmentId}
      AND status IN ('open', 'partially_returned', 'damaged')
  `);
  return Number(
    (result.rows[0] as { quantity?: number | string } | undefined)?.quantity ?? 0,
  );
}

async function getBatchesForUpdate(
  tx: DbTransaction,
  itemId: number,
): Promise<FefoBatch[]> {
  const result = await tx.execute(sql`
    SELECT id, remaining_quantity, expiry_date, batch_number
    FROM inventory_batches
    WHERE item_id = ${itemId}
      AND remaining_quantity > 0
    ORDER BY expiry_date ASC NULLS LAST, id ASC
    FOR UPDATE
  `);
  return result.rows.map((row) => {
    const batch = row as {
      id: number;
      remaining_quantity: number;
      expiry_date: string | null;
      batch_number: string | null;
    };
    return {
      id: Number(batch.id),
      remainingQuantity: Number(batch.remaining_quantity),
      expiryDate: batch.expiry_date ? String(batch.expiry_date).slice(0, 10) : null,
      batchNumber: batch.batch_number ?? null,
    };
  });
}

async function getRecipientSnapshot(
  tx: DbTransaction,
  recipientId: number | null,
): Promise<string | null> {
  if (!recipientId) return null;
  const [recipient] = await tx
    .select({ name: recipientsTable.name })
    .from(recipientsTable)
    .where(and(eq(recipientsTable.id, recipientId), eq(recipientsTable.isActive, true)));
  if (!recipient) {
    throw new InventoryMovementError("RECIPIENT_NOT_FOUND", "الجهة المستلمة غير موجودة", 404);
  }
  return recipient.name;
}

async function getExitReasonSnapshot(
  tx: DbTransaction,
  exitReasonId: number | null,
): Promise<string | null> {
  if (!exitReasonId) return null;
  const [reason] = await tx
    .select({ name: exitReasonsTable.name })
    .from(exitReasonsTable)
    .where(eq(exitReasonsTable.id, exitReasonId));
  if (!reason) {
    throw new InventoryMovementError("EXIT_REASON_NOT_FOUND", "سبب الحركة غير موجود", 404);
  }
  return reason.name;
}

async function insertTransaction(
  tx: DbTransaction,
  context: MovementContext,
  input: MovementInput,
  type: TransactionType,
  entity: ReturnType<typeof assertEntityReference>,
  quantity: number | null,
  documentNumber: string,
  snapshots: {
    recipientNameSnap?: string | null;
    exitReasonSnap?: string | null;
    details?: Record<string, unknown> | null;
  } = {},
) {
  const warehouseId = parseOptionalId(input.warehouseId) ?? (await currentWarehouseId(tx));
  const [transaction] = await tx
    .insert(transactionsTable)
    .values({
      type,
      itemType: entity.itemType,
      itemId: entity.itemId,
      equipmentId: entity.equipmentId,
      quantity,
      recipientId: parseOptionalId(input.recipientId),
      recipientNameSnap: snapshots.recipientNameSnap ?? null,
      recipientPerson: textOrNull(input.recipientPerson),
      exitReasonId: parseOptionalId(input.exitReasonId),
      exitReasonSnap: snapshots.exitReasonSnap ?? null,
      documentNumber,
      warehouseId,
      documentDate: assertIsoDate(input.documentDate, "المستند"),
      deliveryNoteNumber: textOrNull(input.deliveryNoteNumber),
      deliveryNoteDate: assertIsoDate(input.deliveryNoteDate, "مذكرة التسليم"),
      supplySource: input.supplySource
        ? (assertNonEmpty(input.supplySource, "جهة التوريد") as "central_warehouses")
        : null,
      expiryDate: assertIsoDate(input.expiryDate, "الصلاحية"),
      batchNumber: textOrNull(input.batchNumber),
      internalDeliveryNoteNumber: textOrNull(input.internalDeliveryNoteNumber),
      internalDeliveryNoteDate: assertIsoDate(
        input.internalDeliveryNoteDate,
        "مذكرة التسليم الداخلية",
      ),
      deliveryDestination: textOrNull(input.deliveryDestination) as
        | "administrative_building"
        | "health_facility"
        | "ambulance_point"
        | null,
      custodyHolderNameSnap: textOrNull(input.holderName),
      custodyNoteNumber: textOrNull(input.custodyNoteNumber),
      custodyDate: assertIsoDate(input.custodyDate, "تاريخ العهدة"),
      custodyLocation: textOrNull(input.custodyLocation),
      custodyStatus: type === "custody_out" ? "open" : null,
      returnCondition: textOrNull(input.returnCondition),
      reason: textOrNull(input.reason),
      details: snapshots.details ?? null,
      notes: textOrNull(input.notes),
      createdBy: context.userId,
    })
    .returning();
  return transaction;
}

async function decrementItemStock(
  tx: DbTransaction,
  itemId: number,
  quantity: number,
) {
  const result = await tx
    .update(itemsTable)
    .set({
      currentStock: sql`${itemsTable.currentStock} - ${quantity}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(itemsTable.id, itemId),
        sql`${itemsTable.currentStock} >= ${quantity}`,
      ),
    )
    .returning({ id: itemsTable.id });
  if (result.length !== 1) {
    throw new InventoryMovementError(
      "INSUFFICIENT_STOCK",
      "الرصيد الحالي غير كافٍ لإتمام الحركة",
    );
  }
}

async function allocateAndDecrementBatches(
  tx: DbTransaction,
  itemId: number,
  quantity: number,
  transactionId: number,
): Promise<FefoBatch[]> {
  const batches = await getBatchesForUpdate(tx, itemId);
  const allocations = allocateBatchesFefo(batches, quantity, today());
  for (const allocation of allocations) {
    const updated = await tx
      .update(inventoryBatchesTable)
      .set({
        remainingQuantity: sql`${inventoryBatchesTable.remainingQuantity} - ${allocation.quantity}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(inventoryBatchesTable.id, allocation.batchId),
          sql`${inventoryBatchesTable.remainingQuantity} >= ${allocation.quantity}`,
        ),
      )
      .returning({ id: inventoryBatchesTable.id });
    if (updated.length !== 1) {
      throw new InventoryMovementError(
        "BATCH_CHANGED",
        "تغيرت الدفعة أثناء الحركة، يرجى إعادة المحاولة",
        409,
      );
    }
    await tx.insert(transactionBatchAllocationsTable).values({
      transactionId,
      batchId: allocation.batchId,
      quantity: allocation.quantity,
      batchNumberSnap: allocation.batchNumberSnap,
      expiryDateSnap: allocation.expiryDateSnap,
    });
  }
  return batches;
}

async function createInbound(
  tx: DbTransaction,
  context: MovementContext,
  input: MovementInput,
  entity: ReturnType<typeof assertEntityReference>,
  documentNumber: string,
) {
  const quantity = assertPositiveInteger(
    input.quantity ?? (entity.itemType === "equipment" ? 1 : null),
    "الكمية",
  );
  const deliveryNoteNumber = assertNonEmpty(
    input.deliveryNoteNumber,
    "رقم مذكرة التسليم",
  );
  const deliveryNoteDate = assertIsoDate(
    input.deliveryNoteDate,
    "تاريخ مذكرة التسليم",
    true,
  )!;
  const supplySource = input.supplySource
    ? assertNonEmpty(input.supplySource, "جهة التوريد")
    : "central_warehouses";
  if (supplySource !== "central_warehouses") {
    throw new InventoryMovementError(
      "INVALID_SUPPLY_SOURCE",
      "جهة التوريد المعتمدة هي المستودعات المركزية فقط",
    );
  }
  const normalizedInput: MovementInput = {
    ...input,
    supplySource,
    deliveryNoteNumber,
    deliveryNoteDate,
    documentDate: input.documentDate ?? deliveryNoteDate,
  };

  if (entity.itemType === "item") {
    const item = await lockItem(tx, entity.itemId!);
    const transaction = await insertTransaction(
      tx,
      context,
      normalizedInput,
      "in",
      entity,
      quantity,
      documentNumber,
    );
    await tx
      .update(itemsTable)
      .set({
        currentStock: sql`${itemsTable.currentStock} + ${quantity}`,
        updatedAt: new Date(),
      })
      .where(eq(itemsTable.id, item.id));
    const batchWarehouseId = parseOptionalId(input.warehouseId) ?? (await currentWarehouseId(tx));
    await tx.insert(inventoryBatchesTable).values({
      itemId: item.id,
      warehouseId: batchWarehouseId,
      batchNumber: textOrNull(input.batchNumber),
      receivedQuantity: quantity,
      remainingQuantity: quantity,
      expiryDate: assertIsoDate(input.expiryDate, "الصلاحية"),
      supplier: textOrNull(input.supplier),
      deliveryNoteNumber,
      deliveryNoteDate,
      supplySource: "central_warehouses",
      sourceTransactionId: transaction.id,
    });
    return transaction;
  }

  const equipment = await lockEquipment(tx, entity.equipmentId!);
  const transaction = await insertTransaction(
    tx,
    context,
    normalizedInput,
    "in",
    entity,
    quantity,
    documentNumber,
  );
  const updated = await tx
    .update(equipmentTable)
    .set({
      quantity: sql`${equipmentTable.quantity} + ${quantity}`,
      updatedAt: new Date(),
      condition: "good",
    })
    .where(eq(equipmentTable.id, equipment.id));
  return transaction;
}

async function createConsumableOut(
  tx: DbTransaction,
  context: MovementContext,
  input: MovementInput,
  entity: ReturnType<typeof assertEntityReference>,
  documentNumber: string,
) {
  if (entity.itemType !== "item") {
    throw new InventoryMovementError(
      "EQUIPMENT_CUSTODY_REQUIRED",
      "إخراج التجهيزات يتم عبر حركة عهدة شخصية مستقلة",
    );
  }
  const quantity = assertPositiveInteger(input.quantity, "الكمية");
  const internalDeliveryNoteNumber = assertNonEmpty(
    input.internalDeliveryNoteNumber,
    "رقم مذكرة التسليم الداخلية",
  );
  const internalDeliveryNoteDate = assertIsoDate(
    input.internalDeliveryNoteDate,
    "تاريخ مذكرة التسليم الداخلية",
    true,
  )!;
  const deliveryDestination = assertDeliveryDestination(input.deliveryDestination);
  const recipientId = parseOptionalId(input.recipientId);
  const exitReasonId = parseOptionalId(input.exitReasonId);
  if (!recipientId) {
    throw new InventoryMovementError("RECIPIENT_REQUIRED", "الجهة المستلمة مطلوبة");
  }
  if (!exitReasonId) {
    throw new InventoryMovementError("EXIT_REASON_REQUIRED", "سبب الحركة مطلوب");
  }
  const item = await lockItem(tx, entity.itemId!);
  const recipientNameSnap = await getRecipientSnapshot(tx, recipientId);
  const exitReasonSnap = await getExitReasonSnapshot(tx, exitReasonId);
  const transaction = await insertTransaction(
    tx,
    context,
    {
      ...input,
      internalDeliveryNoteNumber,
      internalDeliveryNoteDate,
      deliveryDestination,
    },
    "out",
    entity,
    quantity,
    documentNumber,
    { recipientNameSnap, exitReasonSnap },
  );
  await allocateAndDecrementBatches(tx, item.id, quantity, transaction.id);
  await decrementItemStock(tx, item.id, quantity);
  return transaction;
}

async function createCustodyOut(
  tx: DbTransaction,
  context: MovementContext,
  input: MovementInput,
  entity: ReturnType<typeof assertEntityReference>,
  documentNumber: string,
) {
  if (entity.itemType !== "equipment") {
    throw new InventoryMovementError(
      "CUSTODY_EQUIPMENT_ONLY",
      "العهدة الشخصية متاحة للتجهيزات والثوابت فقط",
    );
  }
  const quantity = assertPositiveInteger(input.quantity, "الكمية");
  const holderName = assertNonEmpty(
    input.holderName ?? input.recipientPerson,
    "اسم مستلم العهدة",
  );
  const custodyNoteNumber = assertNonEmpty(
    input.custodyNoteNumber ?? input.deliveryNoteNumber,
    "رقم مذكرة العهدة",
  );
  const custodyDate = assertIsoDate(
    input.custodyDate ?? input.deliveryNoteDate,
    "تاريخ العهدة",
    true,
  )!;
  const custodyLocation = assertNonEmpty(input.custodyLocation, "مكان العهدة");
  const equipment = await lockEquipment(tx, entity.equipmentId!);
  if (equipment.serial_number && quantity !== 1) {
    throw new InventoryMovementError(
      "SERIAL_EQUIPMENT_QUANTITY_INVALID",
      "التجهيز ذو الرقم التسلسلي يمثل وحدة واحدة فقط",
    );
  }
  const openCustody = await getOpenCustodyQuantity(tx, equipment.id);
  const available = calculateEquipmentAvailable(equipment.quantity, openCustody);
  if (available < quantity) {
    throw new InventoryMovementError(
      "INSUFFICIENT_EQUIPMENT_AVAILABLE",
      `التجهيز المتاح للعهدة غير كافٍ (المتاح ${available}، المطلوب ${quantity})`,
    );
  }
  const recipientId = parseOptionalId(input.recipientId);
  const recipientNameSnap = recipientId
    ? await getRecipientSnapshot(tx, recipientId)
    : holderName;
  const transaction = await insertTransaction(
    tx,
    context,
    {
      ...input,
      holderName,
      custodyNoteNumber,
      custodyDate,
      custodyLocation,
    },
    "custody_out",
    entity,
    quantity,
    documentNumber,
    { recipientNameSnap },
  );
  await tx.insert(personalCustodiesTable).values({
    equipmentId: equipment.id,
    sourceTransactionId: transaction.id,
    recipientId,
    holderNameSnap: holderName,
    deliveryNoteNumber: custodyNoteNumber,
    deliveryDate: custodyDate,
    quantity,
    location: custodyLocation,
    createdBy: context.userId,
  });
   const updated = await tx
    .update(equipmentTable)
    .set({
      currentHolder:
        quantity === 1 ? holderName : equipment.current_holder,
      updatedAt: new Date(),
    })
    .where(eq(equipmentTable.id, equipment.id));
  return transaction;
}

async function createDamage(
  tx: DbTransaction,
  context: MovementContext,
  input: MovementInput,
  entity: ReturnType<typeof assertEntityReference>,
  documentNumber: string,
) {
  const quantity = assertPositiveInteger(input.quantity, "الكمية");
  const reason = assertMeaningfulReason(input.reason, "التلف");
  const damageDate = assertIsoDate(input.damageDate ?? input.documentDate ?? today(), "تاريخ التلف", true)!;

  if (entity.itemType === "item") {
    const item = await lockItem(tx, entity.itemId!);
    const transaction = await insertTransaction(
      tx,
      context,
      { ...input, reason, damageDate },
      "damage",
      entity,
      quantity,
      documentNumber,
    );
    await allocateAndDecrementBatches(tx, item.id, quantity, transaction.id);
    await decrementItemStock(tx, item.id, quantity);
    await tx.insert(damageRecordsTable).values({
      transactionId: transaction.id,
      itemType: "item",
      itemId: item.id,
      quantity,
      reason,
      damageDate,
      documentNumber,
      notes: textOrNull(input.notes),
      createdBy: context.userId,
    });
    return transaction;
  }

  const equipment = await lockEquipment(tx, entity.equipmentId!);
  const openCustody = await getOpenCustodyQuantity(tx, equipment.id);
  const available = calculateEquipmentAvailable(equipment.quantity, openCustody);
  if (available < quantity) {
    throw new InventoryMovementError(
      "INSUFFICIENT_EQUIPMENT_AVAILABLE",
      "لا يمكن تسجيل تلف لكمية موجودة حاليًا في عهدة شخصية",
    );
  }
  const transaction = await insertTransaction(
    tx,
    context,
    { ...input, reason, damageDate },
    "damage",
    entity,
    quantity,
    documentNumber,
  );
  const updated = await tx
    .update(equipmentTable)
    .set({
      quantity: sql`${equipmentTable.quantity} - ${quantity}`,
      condition: "broken",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(equipmentTable.id, equipment.id),
        sql`${equipmentTable.quantity} >= ${quantity}`,
      ),
    )
    .returning({ id: equipmentTable.id });
  if (updated.length !== 1) {
    throw new InventoryMovementError(
      "INSUFFICIENT_EQUIPMENT_AVAILABLE",
      "لم يعد رصيد التجهيز كافيًا بعد القفل",
    );
  }
  await tx.insert(damageRecordsTable).values({
    transactionId: transaction.id,
    itemType: "equipment",
    equipmentId: equipment.id,
    quantity,
    reason,
    damageDate,
    documentNumber,
    serialNumberSnap: equipment.serial_number,
    notes: textOrNull(input.notes),
    createdBy: context.userId,
  });
  return transaction;
}

async function createCustodyReturn(
  tx: DbTransaction,
  context: MovementContext,
  input: MovementInput,
  documentNumber: string,
) {
  const custodyId = parseOptionalId(input.custodyId);
  if (!custodyId) {
    throw new InventoryMovementError("CUSTODY_REQUIRED", "العهدة الأصلية مطلوبة");
  }
  const quantity = assertPositiveInteger(input.quantity, "الكمية");
  const condition = assertNonEmpty(input.returnCondition, "حالة الصنف عند الإعادة");
  const resolvedCondition = await resolveReturnCondition(tx, condition);
  const returnDate = assertIsoDate(input.documentDate ?? today(), "تاريخ الإعادة", true)!;
  const returnedToLocation = assertNonEmpty(
    input.returnedToLocation ?? input.custodyLocation,
    "مكان الإعادة",
  );

  const custodyResult = await tx.execute(sql`
    SELECT id, equipment_id, quantity, returned_quantity, status
    FROM personal_custodies
    WHERE id = ${custodyId}
    FOR UPDATE
  `);
  const custody = custodyResult.rows[0] as
    | {
        id: number;
        equipment_id: number;
        quantity: number;
        returned_quantity: number;
        status: string;
      }
    | undefined;
  if (!custody) {
    throw new InventoryMovementError("CUSTODY_NOT_FOUND", "العهدة غير موجودة", 404);
  }
  const equipment = await lockEquipment(tx, Number(custody.equipment_id));
  const outstanding = Number(custody.quantity) - Number(custody.returned_quantity);
  if (quantity > outstanding) {
    throw new InventoryMovementError(
      "CUSTODY_RETURN_EXCEEDS_BALANCE",
      `كمية الإعادة تتجاوز المتبقي في العهدة (${outstanding})`,
    );
  }
  const entity = assertEntityReference("equipment", null, equipment.id);
  const transaction = await insertTransaction(
    tx,
    context,
    {
      ...input,
      itemType: "equipment",
      equipmentId: equipment.id,
      returnCondition: condition,
    },
    "custody_return",
    entity,
    quantity,
    documentNumber,
  );
  await tx.insert(custodyReturnsTable).values({
    custodyId,
    transactionId: transaction.id,
    quantity,
    returnDate,
    documentNumber,
    condition: resolvedCondition.behavior,
    returnedToLocation,
    inspectionNotes: textOrNull(input.inspectionNotes),
    createdBy: context.userId,
  });

  const nextReturned = Number(custody.returned_quantity) + quantity;
  const nextStatus =
    nextReturned === Number(custody.quantity)
        ? resolvedCondition.behavior === "good"
        ? "returned"
        : resolvedCondition.behavior === "damaged"
          ? "damaged"
          : "closed"
      : "partially_returned";
  await tx
    .update(personalCustodiesTable)
    .set({
      returnedQuantity: nextReturned,
      status: nextStatus,
      updatedAt: new Date(),
    })
    .where(eq(personalCustodiesTable.id, custodyId));

   if (resolvedCondition.behavior !== "good") {
    const updated = await tx
      .update(equipmentTable)
      .set({
        quantity: sql`${equipmentTable.quantity} - ${quantity}`,
         condition: resolvedCondition.behavior === "needs_maintenance" ? "maintenance" : "broken",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(equipmentTable.id, equipment.id),
          sql`${equipmentTable.quantity} >= ${quantity}`,
        ),
      )
      .returning({ id: equipmentTable.id });
    if (updated.length !== 1) {
      throw new InventoryMovementError(
        "INSUFFICIENT_EQUIPMENT_AVAILABLE",
        "لم يعد رصيد التجهيز كافيًا لإتمام الإعادة",
      );
    }
  }
  return transaction;
}

async function createCentralReturn(
  tx: DbTransaction,
  context: MovementContext,
  input: MovementInput,
  entity: ReturnType<typeof assertEntityReference>,
  documentNumber: string,
) {
  const quantity = assertPositiveInteger(input.quantity, "الكمية");
  const reason = assertMeaningfulReason(input.reason, "المرتجع");
  const condition = assertNonEmpty(input.returnCondition, "حالة المرتجع");
  const resolvedCondition = await resolveReturnCondition(tx, condition);

  if (entity.itemType === "item") await lockItem(tx, entity.itemId!);
  else {
    const equipment = await lockEquipment(tx, entity.equipmentId!);
    const openCustody = await getOpenCustodyQuantity(tx, equipment.id);
    const available = calculateEquipmentAvailable(equipment.quantity, openCustody);
    if (available < quantity) {
      throw new InventoryMovementError(
        "INSUFFICIENT_EQUIPMENT_AVAILABLE",
        "لا يمكن إرجاع كمية موجودة في عهدة شخصية إلى المستودع المركزي",
      );
    }
  }

  const transaction = await insertTransaction(
    tx,
    context,
    { ...input, reason, returnCondition: condition },
    "central_return",
    entity,
    quantity,
    documentNumber,
  );
  if (entity.itemType === "item") {
    await allocateAndDecrementBatches(tx, entity.itemId!, quantity, transaction.id);
    await decrementItemStock(tx, entity.itemId!, quantity);
  } else {
     const updated = await tx
      .update(equipmentTable)
      .set({
        quantity: sql`${equipmentTable.quantity} - ${quantity}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(equipmentTable.id, entity.equipmentId!),
          sql`${equipmentTable.quantity} >= ${quantity}`,
        ),
       )
       .returning({ id: equipmentTable.id });
     if (updated.length !== 1) {
       throw new InventoryMovementError(
         "INSUFFICIENT_EQUIPMENT_AVAILABLE",
         "لم يعد رصيد التجهيز كافيًا لإتمام المرتجع",
       );
     }
  }
  await tx.insert(centralReturnsTable).values({
    transactionId: transaction.id,
    itemType: entity.itemType,
    itemId: entity.itemId,
    equipmentId: entity.equipmentId,
    quantity,
    returnDate: assertIsoDate(input.documentDate ?? today(), "تاريخ المرتجع", true)!,
    documentNumber,
    receivingPartySnap: "central_warehouses",
     condition: resolvedCondition.behavior,
    reason,
    notes: textOrNull(input.notes),
    createdBy: context.userId,
  });
  return transaction;
}

async function createAdjustment(
  tx: DbTransaction,
  context: MovementContext,
  input: MovementInput,
  documentNumber: string,
) {
  // ── Shared validation (approved plan §4.1) ────────────────────────────────
  const newStock = Number.parseInt(String(input.newStock ?? ""), 10);
  if (!Number.isSafeInteger(newStock) || newStock < 0) {
    throw new InventoryMovementError("INVALID_STOCK", "الرصيد الجديد يجب أن يكون صفرًا أو أكبر");
  }
  const rawReason = String(input.reason ?? "").trim();
  if (!rawReason) {
    throw new InventoryMovementError("REQUIRED_FIELD", "رقم المحضر مطلوب");
  }
  if (rawReason.length < 5) {
    throw new InventoryMovementError("REASON_TOO_SHORT", "رقم المحضر قصير جدًا (5 أحرف على الأقل)");
  }
  // Mandatory voucher date for adjustments (approved plan §3.8).
  // The shared helper throws INVALID_DATE; the approved contract for the
  // adjust endpoint is INVALID_DOCUMENT_DATE (approved plan §4).
  try {
    assertIsoDate(input.documentDate, "تاريخ الجرد", true);
  } catch {
    throw new InventoryMovementError(
      "INVALID_DOCUMENT_DATE",
      "تاريخ الجرد مطلوب بصيغة YYYY-MM-DD",
    );
  }

  const itemId = parseOptionalId(input.itemId);
  const equipmentId = parseOptionalId(input.equipmentId);
  if (itemId && equipmentId) {
    throw new InventoryMovementError(
      "ENTITY_TYPE_MISMATCH",
      "أرسل مرجع مادة أو تجهيز وليس كليهما معًا",
    );
  }

  // ── Item adjustment (legacy behavior preserved) ───────────────────────────
  if (itemId) {
    const item = await lockItem(tx, itemId);
    const delta = newStock - Number(item.current_stock);
    if (delta === 0) {
      throw new InventoryMovementError("NO_STOCK_CHANGE", "الرصيد الجديد يساوي الرصيد الحالي");
    }
    const entity = assertEntityReference("item", itemId, null);
    const details = {
      previousStock: Number(item.current_stock),
      newStock,
      delta,
      deltaType: delta > 0 ? "increase" : "decrease",
    };
    const transaction = await insertTransaction(
      tx,
      context,
      {
        ...input,
        itemType: "item",
        itemId,
        reason: rawReason,
        notes: [
          `تسوية جرد — رقم المحضر: ${rawReason}`,
          `الكمية قبل: ${item.current_stock}، الكمية بعد: ${newStock}، الفرق: ${delta >= 0 ? "+" : ""}${delta}`,
          textOrNull(input.notes),
        ]
          .filter(Boolean)
          .join(". "),
      },
      "adjust",
      entity,
      Math.abs(delta),
      documentNumber,
      { details },
    );
    await tx
      .update(itemsTable)
      .set({ currentStock: newStock, updatedAt: new Date() })
      .where(eq(itemsTable.id, itemId));
    // adjustment keeps the batch ledger coherent (audit P0): an increase opens a
    // batch, a decrease consumes batches FEFO up to what the ledger actually holds.
    if (delta > 0) {
      const batchWarehouseId = parseOptionalId(input.warehouseId) ?? (await currentWarehouseId(tx));
      await tx.insert(inventoryBatchesTable).values({
        itemId,
        warehouseId: batchWarehouseId,
        batchNumber: null,
        receivedQuantity: delta,
        remainingQuantity: delta,
        expiryDate: null,
        supplier: null,
        deliveryNoteNumber: documentNumber,
        deliveryNoteDate: today(),
        sourceTransactionId: transaction.id,
      });
    } else {
      const batches = await getBatchesForUpdate(tx, itemId);
      const available = batches.reduce((sum, batch) => sum + batch.remainingQuantity, 0);
      const consumable = Math.min(Math.abs(delta), available);
      if (consumable > 0) {
        await allocateAndDecrementBatches(tx, itemId, consumable, transaction.id);
      }
    }
    return transaction;
  }

  // ── Equipment adjustment (approved plan §3.3/§3.5/§4) ─────────────────────
  if (!equipmentId) {
    throw new InventoryMovementError(
      "ENTITY_TYPE_MISMATCH",
      "يجب تحديد مادة أو تجهيز للتسوية",
    );
  }
  const equipment = await lockEquipment(tx, equipmentId);
  // Serialized equipment is handled through loss/scrap/condition paths.
  if (equipment.serial_number) {
    throw new InventoryMovementError(
      "SERIAL_EQUIPMENT_ADJUSTMENT_BLOCKED",
      "التجهيز المسلسَل يُعالَج عبر مسار الفقد/الشطب أو تغيير الحالة، وليس عبر تسوية الجرد",
      409,
    );
  }
  const openCustody = await getOpenCustodyQuantity(tx, equipment.id);
  if (newStock < openCustody) {
    throw new InventoryMovementError(
      "EQUIPMENT_CUSTODY_BALANCE",
      `لا يمكن إنقاص رصيد التجهيز عن الكمية المفتوحة على العهد (${openCustody})`,
      409,
    );
  }
  const delta = newStock - Number(equipment.quantity);
  if (delta === 0) {
    throw new InventoryMovementError("NO_STOCK_CHANGE", "الرصيد الجديد يساوي الرصيد الحالي");
  }
  const entity = assertEntityReference("equipment", null, equipment.id);
  const available = calculateEquipmentAvailable(equipment.quantity, openCustody);
  const details = {
    previousStock: Number(equipment.quantity),
    newStock,
    delta,
    deltaType: delta > 0 ? "increase" : "decrease",
    openCustody,
    availableBefore: available,
    equipmentNameSnap: equipment.name,
    equipmentModelSnap: equipment.model ?? null,
    equipmentSerialSnap: equipment.serial_number ?? null,
    equipmentConditionSnap: equipment.condition,
  };
  const transaction = await insertTransaction(
    tx,
    context,
    {
      ...input,
      itemType: "equipment",
      equipmentId: equipment.id,
      reason: rawReason,
      notes: [
          `تسوية جرد — رقم المحضر: ${rawReason}`,
        `الكمية قبل: ${equipment.quantity}، الكمية بعد: ${newStock}، الفرق: ${delta >= 0 ? "+" : ""}${delta}`,
        `العهد المفتوحة: ${openCustody}`,
        textOrNull(input.notes),
      ]
        .filter(Boolean)
        .join(". "),
    },
    "adjust",
    entity,
    Math.abs(delta),
    documentNumber,
    { details },
  );
  await tx
    .update(equipmentTable)
    .set({ quantity: newStock, updatedAt: new Date() })
    .where(eq(equipmentTable.id, equipment.id));
  return transaction;
}

/**
 * Build the sync payload for a movement: the full transaction row plus
 * business effects (item/equipment stock snapshots, FEFO batches and
 * allocations, custody rows, damage/central-return records). References to
 * local ids travel as global-id carriers so the receiver can re-map them.
 */
async function buildMovementSyncPayload(
  tx: DbTransaction,
  options: {
    type: TransactionType;
    transaction: typeof transactionsTable.$inferSelect;
    entity: ReturnType<typeof assertEntityReference> | null;
    input: MovementInput;
    transactionGlobalId: string;
  },
) {
  const { type, transaction, entity, input, transactionGlobalId } = options;
  const effects: Array<{
    entityType: string;
    entityGlobalId: string;
    changeType: string;
    row: Record<string, unknown>;
  }> = [];
  const txRow: Record<string, unknown> = { ...transaction };

  const addItemEffect = async (itemId: number) => {
    const [item] = await tx
      .select()
      .from(itemsTable)
      .where(eq(itemsTable.id, itemId))
      .limit(1);
    if (!item) return;
    const itemGlobalId = await ensureEntityIdentity(tx, "item", item.id);
    txRow.itemGlobalId = itemGlobalId;
    effects.push({
      entityType: "item",
      entityGlobalId: itemGlobalId,
      changeType: "update",
      row: {
        ...item,
        categoryGlobalId: item.categoryId
          ? await ensureEntityIdentity(tx, "category", item.categoryId)
          : null,
      },
    });
    // FEFO state travels with the movement so balances and batch
    // remaining quantities converge together.
    const batches = await tx
      .select()
      .from(inventoryBatchesTable)
      .where(eq(inventoryBatchesTable.itemId, item.id))
      .orderBy(asc(inventoryBatchesTable.id));
    for (const batch of batches) {
      const batchGlobalId = await ensureEntityIdentity(tx, "inventory_batch", batch.id);
      effects.push({
        entityType: "inventory_batch",
        entityGlobalId: batchGlobalId,
        changeType: "update",
        row: {
          ...batch,
          itemGlobalId,
          transactionGlobalId: batch.sourceTransactionId ? transactionGlobalId : null,
        },
      });
    }
    if (type === "out") {
      const allocations = await tx
        .select()
        .from(transactionBatchAllocationsTable)
        .where(eq(transactionBatchAllocationsTable.transactionId, transaction.id));
      for (const allocation of allocations) {
        const allocationGlobalId = await ensureEntityIdentity(
          tx,
          "batch_allocation",
          allocation.id,
        );
        const batchGlobalId = await ensureEntityIdentity(
          tx,
          "inventory_batch",
          allocation.batchId,
        );
        effects.push({
          entityType: "batch_allocation",
          entityGlobalId: allocationGlobalId,
          changeType: "create",
          row: { ...allocation, transactionGlobalId, batchGlobalId },
        });
      }
    }
  };

  const addEquipmentEffect = async (equipmentId: number) => {
    const [equipment] = await tx
      .select()
      .from(equipmentTable)
      .where(eq(equipmentTable.id, equipmentId))
      .limit(1);
    if (!equipment) return;
    const equipmentGlobalId = await ensureEntityIdentity(tx, "equipment", equipment.id);
    txRow.equipmentGlobalId = equipmentGlobalId;
    effects.push({
      entityType: "equipment",
      entityGlobalId: equipmentGlobalId,
      changeType: "update",
      row: { ...equipment },
    });
  };

  if (entity?.itemType === "item" && entity.itemId) {
    await addItemEffect(entity.itemId);
  }
  if (entity?.itemType === "equipment" && entity.equipmentId) {
    await addEquipmentEffect(entity.equipmentId);
  }

  if (type === "custody_out") {
    const custodies = await tx
      .select()
      .from(personalCustodiesTable)
      .where(eq(personalCustodiesTable.sourceTransactionId, transaction.id));
    for (const custody of custodies) {
      const custodyGlobalId = await ensureEntityIdentity(tx, "personal_custody", custody.id);
      effects.push({
        entityType: "personal_custody",
        entityGlobalId: custodyGlobalId,
        changeType: "create",
        row: {
          ...custody,
          equipmentGlobalId: txRow.equipmentGlobalId,
          transactionGlobalId,
        },
      });
    }
  }
  if (type === "custody_return") {
    const returns = await tx
      .select()
      .from(custodyReturnsTable)
      .where(eq(custodyReturnsTable.transactionId, transaction.id));
    const custodyId = parseOptionalId(input.custodyId);
    const custodyGlobalId = custodyId
      ? await ensureEntityIdentity(tx, "personal_custody", custodyId)
      : undefined;
    for (const ret of returns) {
      const returnGlobalId = await ensureEntityIdentity(tx, "custody_return", ret.id);
      effects.push({
        entityType: "custody_return",
        entityGlobalId: returnGlobalId,
        changeType: "create",
        row: { ...ret, transactionGlobalId, custodyGlobalId },
      });
    }
    if (custodyId && custodyGlobalId) {
      const [custody] = await tx
        .select()
        .from(personalCustodiesTable)
        .where(eq(personalCustodiesTable.id, custodyId))
        .limit(1);
      if (custody) {
        // Equipment balance changes on return; attach the equipment effect.
        await addEquipmentEffect(custody.equipmentId);
        effects.push({
          entityType: "personal_custody",
          entityGlobalId: custodyGlobalId,
          changeType: "update",
          row: {
            ...custody,
            equipmentGlobalId: txRow.equipmentGlobalId,
            transactionGlobalId,
          },
        });
      }
    }
  }
  if (type === "damage") {
    const records = await tx
      .select()
      .from(damageRecordsTable)
      .where(eq(damageRecordsTable.transactionId, transaction.id));
    for (const record of records) {
      const recordGlobalId = await ensureEntityIdentity(tx, "damage_record", record.id);
      effects.push({
        entityType: "damage_record",
        entityGlobalId: recordGlobalId,
        changeType: "create",
        row: {
          ...record,
          transactionGlobalId,
          itemGlobalId: txRow.itemGlobalId,
          equipmentGlobalId: txRow.equipmentGlobalId,
        },
      });
    }
  }
  if (type === "central_return") {
    const records = await tx
      .select()
      .from(centralReturnsTable)
      .where(eq(centralReturnsTable.transactionId, transaction.id));
    for (const record of records) {
      const recordGlobalId = await ensureEntityIdentity(tx, "central_return", record.id);
      effects.push({
        entityType: "central_return",
        entityGlobalId: recordGlobalId,
        changeType: "create",
        row: {
          ...record,
          transactionGlobalId,
          itemGlobalId: txRow.itemGlobalId,
          equipmentGlobalId: txRow.equipmentGlobalId,
        },
      });
    }
  }

  return { transaction: txRow, effects };
}

export async function createInventoryMovementInTransaction(
  tx: DbTransaction,
  input: MovementInput,
  context: MovementContext,
  nodeOverride?: Awaited<ReturnType<typeof ensureNodeIdentity>>,
) {
  const node = nodeOverride ?? (await ensureNodeIdentity("web"));
  const operationId = randomUUID();
  const originSequence = await reserveOriginSequence(tx, node.nodeId);
  const type = input.kind as TransactionType;
  const documentNumber = await lockDocumentNumber(tx, type);

  let entity: ReturnType<typeof assertEntityReference> | null = null;
  if (input.kind !== "custody_return") {
    entity = assertEntityReference(input.itemType, input.itemId, input.equipmentId);
  }

  let transaction;
  switch (input.kind) {
    case "in":
      transaction = await createInbound(tx, context, input, entity!, documentNumber);
      break;
    case "out":
      // The consumables route is intentionally exclusive. Personal
      // custody has its own endpoint and audit type.
      transaction = await createConsumableOut(tx, context, input, entity!, documentNumber);
      break;
    case "custody_out":
      transaction = await createCustodyOut(tx, context, input, entity!, documentNumber);
      break;
    case "damage":
      transaction = await createDamage(tx, context, input, entity!, documentNumber);
      break;
    case "custody_return":
      transaction = await createCustodyReturn(tx, context, input, documentNumber);
      break;
    case "central_return":
      transaction = await createCentralReturn(tx, context, input, entity!, documentNumber);
      break;
    case "adjust":
      transaction = await createAdjustment(tx, context, input, documentNumber);
      break;
    default:
      throw new InventoryMovementError("INVALID_MOVEMENT_TYPE", "نوع الحركة غير مدعوم");
  }

  const transactionGlobalId = await ensureEntityIdentity(
    tx,
    "transaction",
    transaction.id,
  );
  await tx
    .update(transactionsTable)
    .set({
      operationId,
      originNodeId: node.nodeId,
      originSequence,
      documentNumberScope: `web:${type}`,
    })
    .where(eq(transactionsTable.id, transaction.id));
  Object.assign(transaction, {
    operationId,
    originNodeId: node.nodeId,
    originSequence,
    documentNumberScope: `web:${type}`,
  });
  const syncPayload = await buildMovementSyncPayload(tx, {
    type,
    transaction,
    entity,
    input,
    transactionGlobalId,
  });
  await recordLocalChange(tx, {
    nodeId: node.nodeId,
    operationId,
    originSequence,
    entityType: "transaction",
    localEntityId: transaction.id,
    globalId: transactionGlobalId,
    changeType: "create",
    payload: syncPayload,
  });

  await writeAudit(tx, context, "movement_created", transaction.id, {
    movementType: transaction.type,
    documentNumber: transaction.documentNumber,
    itemType: transaction.itemType,
    itemId: transaction.itemId,
    equipmentId: transaction.equipmentId,
    quantity: transaction.quantity,
  });
  return transaction;
}

export async function createInventoryMovement(
  input: MovementInput,
  context: MovementContext,
) {
  try {
    // Resolve the node identity before opening the transaction. PGlite uses a
    // single connection per local database, so querying the global db handle
    // from inside an active transaction can leave the movement request
    // waiting indefinitely.
    const node = await ensureNodeIdentity("web");
    return await db.transaction((tx) =>
      createInventoryMovementInTransaction(tx, input, context, node),
    );
  } catch (error) {
    // Failed sensitive operations are also auditable. This insert is outside
    // the rolled-back movement transaction by design, so the failure survives.
    try {
      await db.insert(auditLogTable).values({
        userId: context.userId,
        userNameSnap: context.userName,
        action: "movement_failed",
        entityType: "transaction",
        entityId: null,
        details: {
          code:
            error instanceof InventoryMovementError
              ? error.code
              : "INTERNAL_MOVEMENT_ERROR",
          message:
            error instanceof Error ? error.message : "unknown movement error",
          movementType: input.kind,
          itemType: input.itemType ?? null,
          itemId: input.itemId ?? null,
          equipmentId: input.equipmentId ?? null,
        },
        ipAddress: context.ipAddress,
      });
    } catch (auditError) {
      console.error("[audit] failed to record movement failure:", auditError);
    }
    throw error;
  }
}