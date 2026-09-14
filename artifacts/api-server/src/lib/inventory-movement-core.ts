export class InventoryMovementError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "InventoryMovementError";
  }
}

export type FefoBatch = {
  id: number;
  remainingQuantity: number;
  expiryDate: string | null;
  batchNumber: string | null;
};

export type BatchAllocation = {
  batchId: number;
  quantity: number;
  batchNumberSnap: string | null;
  expiryDateSnap: string | null;
};

export function assertPositiveInteger(
  value: unknown,
  field: string,
): number {
  const normalized =
    typeof value === "number" ? value : String(value ?? "").trim();
  const parsed =
    typeof normalized === "number"
      ? normalized
      : /^\d+$/.test(normalized)
        ? Number(normalized)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new InventoryMovementError(
      "INVALID_QUANTITY",
      `يجب أن تكون ${field} عددًا صحيحًا أكبر من الصفر`,
    );
  }
  return parsed;
}

export function assertNonEmpty(value: unknown, field: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new InventoryMovementError(
      "REQUIRED_FIELD",
      `الحقل ${field} مطلوب`,
    );
  }
  return normalized;
}

export function assertMeaningfulReason(value: unknown, field: string): string {
  const normalized = assertNonEmpty(value, field);
  if (normalized.length < 5) {
    throw new InventoryMovementError(
      "REASON_TOO_SHORT",
      `سبب ${field} قصير جدًا (5 أحرف على الأقل)`,
    );
  }
  return normalized;
}

export function assertIsoDate(
  value: unknown,
  field: string,
  required = false,
): string | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    if (required) {
      throw new InventoryMovementError(
        "INVALID_DATE",
        `التاريخ ${field} مطلوب`,
      );
    }
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new InventoryMovementError(
      "INVALID_DATE",
      `التاريخ ${field} يجب أن يكون بالصيغة YYYY-MM-DD`,
    );
  }

  const date = new Date(`${normalized}T00:00:00Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== normalized
  ) {
    throw new InventoryMovementError(
      "INVALID_DATE",
      `التاريخ ${field} غير صالح`,
    );
  }
  return normalized;
}

export function assertEntityReference(
  itemType: unknown,
  itemId: unknown,
  equipmentId: unknown,
): { itemType: "item" | "equipment"; itemId: number | null; equipmentId: number | null } {
  if (itemType !== "item" && itemType !== "equipment") {
    throw new InventoryMovementError(
      "INVALID_ITEM_TYPE",
      "نوع الصنف يجب أن يكون مادة أو تجهيزًا",
    );
  }

  const parseId = (value: unknown) => {
    if (value === undefined || value === null || value === "") return null;
    const normalized = String(value).trim();
    return /^\d+$/.test(normalized) ? Number(normalized) : Number.NaN;
  };
  const parsedItemId = parseId(itemId);
  const parsedEquipmentId = parseId(equipmentId);
  const validItemId =
    parsedItemId !== null &&
    Number.isSafeInteger(parsedItemId) &&
    parsedItemId > 0;
  const validEquipmentId =
    parsedEquipmentId !== null &&
    Number.isSafeInteger(parsedEquipmentId) &&
    parsedEquipmentId > 0;

  if (
    (itemType === "item" && (!validItemId || validEquipmentId)) ||
    (itemType === "equipment" && (validItemId || !validEquipmentId))
  ) {
    throw new InventoryMovementError(
      "ENTITY_TYPE_MISMATCH",
      "يجب أن يتطابق نوع الصنف مع مرجع المادة أو التجهيز",
    );
  }

  return {
    itemType,
    itemId: validItemId ? parsedItemId : null,
    equipmentId: validEquipmentId ? parsedEquipmentId : null,
  };
}

/**
 * Allocate the requested quantity in FEFO order.
 *
 * Expired batches are intentionally excluded. A batch without an expiry date
 * is valid, but is ordered after every non-expiring batch with a date.
 */
export function allocateBatchesFefo(
  batches: FefoBatch[],
  requestedQuantity: number,
  today: string,
): BatchAllocation[] {
  const quantity = assertPositiveInteger(requestedQuantity, "الكمية");
  const eligible = batches
    .filter(
      (batch) =>
        batch.remainingQuantity > 0 &&
        (!batch.expiryDate || batch.expiryDate >= today),
    )
    .sort((left, right) => {
      if (left.expiryDate === null && right.expiryDate !== null) return 1;
      if (left.expiryDate !== null && right.expiryDate === null) return -1;
      if (left.expiryDate !== right.expiryDate) {
        return (left.expiryDate ?? "9999-12-31").localeCompare(
          right.expiryDate ?? "9999-12-31",
        );
      }
      return left.id - right.id;
    });

  const available = eligible.reduce(
    (total, batch) => total + batch.remainingQuantity,
    0,
  );
  if (available < quantity) {
    throw new InventoryMovementError(
      "INSUFFICIENT_BATCH_STOCK",
      `الرصيد القابل للصرف من الدفعات غير كافٍ (المتاح ${available}، المطلوب ${quantity})`,
      400,
      { available, requested: quantity },
    );
  }

  let remaining = quantity;
  return eligible.flatMap((batch) => {
    if (remaining <= 0) return [];
    const allocated = Math.min(batch.remainingQuantity, remaining);
    remaining -= allocated;
    return [
      {
        batchId: batch.id,
        quantity: allocated,
        batchNumberSnap: batch.batchNumber,
        expiryDateSnap: batch.expiryDate,
      },
    ];
  });
}

export function calculateEquipmentAvailable(
  totalQuantity: number,
  openCustodyQuantity: number,
): number {
  return Math.max(0, totalQuantity - openCustodyQuantity);
}