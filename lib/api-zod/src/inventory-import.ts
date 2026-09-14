export type ImportMode = "insert" | "upsert";

export type InventoryImportRowState = "valid" | "warning" | "error" | "empty";

export type InventoryImportAction =
  | "none"
  | "create-item"
  | "update-item"
  | "create-opening-batch";

export type InventoryImportRow = {
  rowNumber: number;
  code: string | null;
  name: string;
  unit: string;
  categoryName: string | null;
  currentStock: number | null;
  minStock: number | null;
  expiryDate: string | null;
  batchNumber: string | null;
  supplier: string | null;
  location: string | null;
  notes: string | null;
  unknownHeaders: string[];
  duplicateHeaders: string[];
  dateError: string | null;
};

export type InventoryOpeningBatchRow = {
  rowNumber: number;
  code: string | null;
  quantity: number | null;
  batchNumber: string | null;
  expiryDate: string | null;
  supplier: string | null;
  deliveryNoteNumber: string | null;
  deliveryNoteDate: string | null;
  unknownHeaders: string[];
  duplicateHeaders: string[];
  expiryDateError: string | null;
  deliveryNoteDateError: string | null;
};

export type InventoryInputMovement = {
  rowNumber: number;
  itemCode: string | null;
  quantity: number | null;
  batchNumber: string | null;
  expiryDate: string | null;
  supplier: string | null;
  deliveryNoteNumber: string | null;
  deliveryNoteDate: string | null;
  notes: string | null;
  source: "opening-import" | "receipt" | "adjustment";
};

export type ExistingInventoryItem = {
  id: number;
  code: string | null;
  name: string;
  requiresExpiryTracking?: boolean | null;
  requiresBatchTracking?: boolean | null;
};

export type InventoryImportContext = {
  mode: ImportMode;
  categories: Map<string, number>;
  existingByCode: Map<string, ExistingInventoryItem>;
  /** When provided, units are checked using the same normalized lookup as categories. */
  units?: Set<string>;
  seenCodes?: Set<string>;
};

export type InventoryOpeningBatchContext = {
  existingByCode: Map<string, ExistingInventoryItem>;
  seenBatchKeys?: Set<string>;
  existingBatchKeys?: Set<string>;
};

export type InventoryImportIssue = {
  code: string;
  message: string;
};

export type InventoryImportDecision = {
  state: InventoryImportRowState;
  action: InventoryImportAction;
  createsOpeningBatch: boolean;
  errors: InventoryImportIssue[];
  warnings: InventoryImportIssue[];
  row: InventoryImportRow;
  existingItem: ExistingInventoryItem | null;
};

export type InventoryOpeningBatchDecision = {
  state: InventoryImportRowState;
  action: "none" | "create-opening-batch" | "skip-existing-batch";
  errors: InventoryImportIssue[];
  warnings: InventoryImportIssue[];
  row: InventoryOpeningBatchRow;
  existingItem: ExistingInventoryItem | null;
  skipExistingBatch?: boolean;
};

export const INVENTORY_TEMPLATE_VERSION = "4.0";

export const INVENTORY_SHEET_NAMES = {
  items: "المواد",
  openingBatches: "الأرصدة والدفعات الافتتاحية",
  instructions: "التعليمات",
  referenceValues: "القيم المرجعية",
} as const;

export const INVENTORY_TEMPLATE_COLUMNS = {
  items: [
    { key: "code", label: "الرمز", required: false, type: "text" },
    { key: "name", label: "الاسم", required: true, type: "text" },
    { key: "unit", label: "الوحدة", required: true, type: "text" },
    { key: "categoryName", label: "التصنيف", required: false, type: "text" },
    { key: "minStock", label: "الحد الأدنى", required: false, type: "integer" },
    { key: "location", label: "الموقع", required: false, type: "text" },
    { key: "notes", label: "ملاحظات", required: false, type: "text" },
  ],
  openingBatches: [
    { key: "code", label: "رمز المادة", required: true, type: "text" },
    { key: "quantity", label: "الكمية الافتتاحية", required: true, type: "integer" },
    { key: "batchNumber", label: "رقم الدفعة", required: false, type: "text" },
    { key: "expiryDate", label: "تاريخ الصلاحية", required: false, type: "date" },
    { key: "supplier", label: "المورد", required: false, type: "text" },
    { key: "deliveryNoteNumber", label: "رقم سند الإدخال", required: false, type: "text" },
    { key: "deliveryNoteDate", label: "تاريخ سند الإدخال", required: false, type: "date" },
  ],
} as const;

export const DEFAULT_INVENTORY_UNITS = [
  "قطعة",
  "علبة",
  "لتر",
  "مل",
  "كيس",
  "زجاجة",
  "برميل",
  "رول",
  "كرتون",
  "طرد",
  "حبة",
  "زوج",
  "مجموعة",
  "جرام",
  "كيلوغرام",
] as const;

const HEADER_ALIASES: Record<string, string> = {
  code: "code",
  "رمز المادة": "code",
  الرمز: "code",
  الاسم: "name",
  "اسم المادة": "name",
  name: "name",
  الوحدة: "unit",
  "وحدة القياس": "unit",
  unit: "unit",
  التصنيف: "categoryName",
  تصنيف: "categoryName",
  category: "categoryName",
  categoryname: "categoryName",
  "الحد الأدنى": "minStock",
  "حد التنبيه": "minStock",
  minstock: "minStock",
  الرصيد: "currentStock",
  "الكمية الحالية": "currentStock",
  "الرصيد الحالي": "currentStock",
  الكمية: "currentStock",
  currentstock: "currentStock",
  "الكمية الافتتاحية": "quantity",
  "الرصيد الافتتاحي": "quantity",
  openingquantity: "quantity",
  quantity: "quantity",
  "تاريخ الانتهاء": "expiryDate",
  "تاريخ الصلاحية": "expiryDate",
  الصلاحية: "expiryDate",
  expirydate: "expiryDate",
  "رقم الدفعة": "batchNumber",
  "رقم التشغيلة": "batchNumber",
  الدفعة: "batchNumber",
  batchnumber: "batchNumber",
  المورد: "supplier",
  supplier: "supplier",
  الموقع: "location",
  location: "location",
  ملاحظات: "notes",
  notes: "notes",
  "رقم سند الإدخال": "deliveryNoteNumber",
  "رقم سند التوريد": "deliveryNoteNumber",
  deliverynotenumber: "deliveryNoteNumber",
  "تاريخ سند الإدخال": "deliveryNoteDate",
  "تاريخ سند التوريد": "deliveryNoteDate",
  deliverynotedate: "deliveryNoteDate",
};

const ITEM_FIELDS = new Set([
  "code",
  "name",
  "unit",
  "categoryName",
  "currentStock",
  "minStock",
  "expiryDate",
  "batchNumber",
  "supplier",
  "location",
  "notes",
]);

const OPENING_BATCH_FIELDS = new Set([
  "code",
  "quantity",
  "batchNumber",
  "expiryDate",
  "supplier",
  "deliveryNoteNumber",
  "deliveryNoteDate",
]);

function headerKey(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/\*+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("ar");
}

export function normalizeHeader(value: unknown) {
  const normalized = headerKey(value);
  return HEADER_ALIASES[normalized] ?? normalized;
}

export function normalizeLookupValue(value: unknown) {
  return headerKey(value);
}

export function normalizeText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

export function normalizeCode(value: unknown): string | null {
  return normalizeText(value);
}

export function isValidIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function excelSerialToIso(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2958465) return null;
  const date = new Date(Date.UTC(1899, 11, 30) + value * 86_400_000);
  const iso = date.toISOString().slice(0, 10);
  return isValidIsoDate(iso) ? iso : null;
}

export function normalizeDate(value: unknown): { value: string | null; error: string | null } {
  if (value === null || value === undefined || value === "") {
    return { value: null, error: null };
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return { value: null, error: "التاريخ غير صالح" };
    const iso = value.toISOString().slice(0, 10);
    return {
      value: isValidIsoDate(iso) ? iso : null,
      error: isValidIsoDate(iso) ? null : "التاريخ غير صالح",
    };
  }
  if (typeof value === "number") {
    const iso = excelSerialToIso(value);
    return iso
      ? { value: iso, error: null }
      : { value: null, error: "رقم تاريخ Excel غير صالح" };
  }
  const normalized = String(value).trim();
  if (!normalized) return { value: null, error: null };
  if (isValidIsoDate(normalized)) return { value: normalized, error: null };
  const arabicDate = normalized.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (arabicDate) {
    const [, day, month, year] = arabicDate;
    const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    if (isValidIsoDate(iso)) return { value: iso, error: null };
  }
  return { value: null, error: "التاريخ غير صالح؛ استخدم YYYY-MM-DD" };
}

export function parseNonNegativeInteger(
  value: unknown,
  fallback: number | null = 0,
): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return fallback;
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  const normalized = String(value).trim();
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function canonicalizeInput(input: Record<string, unknown>) {
  const canonical: Record<string, unknown> = {};
  const unknownHeaders: string[] = [];
  const duplicateHeaders: string[] = [];
  const seenFields = new Set<string>();

  for (const [key, value] of Object.entries(input)) {
    const rawKey = String(key).trim();
    if (!rawKey) continue;
    const mapped = normalizeHeader(rawKey);
    const known = Object.prototype.hasOwnProperty.call(HEADER_ALIASES, headerKey(rawKey));
    if (!known) {
      unknownHeaders.push(rawKey);
      continue;
    }
    if (seenFields.has(mapped)) {
      duplicateHeaders.push(rawKey);
      continue;
    }
    seenFields.add(mapped);
    canonical[mapped] = value;
  }

  return { canonical, unknownHeaders, duplicateHeaders };
}

function hasInputValue(input: Record<string, unknown>) {
  return Object.values(input).some((value) => normalizeText(value) !== null);
}

export function normalizeInventoryRow(
  input: Record<string, unknown>,
  rowNumber: number,
): InventoryImportRow {
  const { canonical, unknownHeaders, duplicateHeaders } = canonicalizeInput(input);
  const date = normalizeDate(canonical.expiryDate);
  return {
    rowNumber,
    code: normalizeCode(canonical.code),
    name: normalizeText(canonical.name) ?? "",
    unit: normalizeText(canonical.unit) ?? "",
    categoryName: normalizeText(canonical.categoryName),
    currentStock: parseNonNegativeInteger(canonical.currentStock, 0),
    minStock: parseNonNegativeInteger(canonical.minStock, 0),
    expiryDate: date.value,
    batchNumber: normalizeText(canonical.batchNumber),
    supplier: normalizeText(canonical.supplier),
    location: normalizeText(canonical.location),
    notes: normalizeText(canonical.notes),
    unknownHeaders: unknownHeaders.filter((header) => !OPENING_BATCH_FIELDS.has(normalizeHeader(header))),
    duplicateHeaders,
    dateError: date.error,
  };
}

export function normalizeOpeningBatchRow(
  input: Record<string, unknown>,
  rowNumber: number,
): InventoryOpeningBatchRow {
  const { canonical, unknownHeaders, duplicateHeaders } = canonicalizeInput(input);
  const expiryDate = normalizeDate(canonical.expiryDate);
  const deliveryNoteDate = normalizeDate(canonical.deliveryNoteDate);
  return {
    rowNumber,
    code: normalizeCode(canonical.code),
    quantity: parseNonNegativeInteger(canonical.quantity, null),
    batchNumber: normalizeText(canonical.batchNumber),
    expiryDate: expiryDate.value,
    supplier: normalizeText(canonical.supplier),
    deliveryNoteNumber: normalizeText(canonical.deliveryNoteNumber),
    deliveryNoteDate: deliveryNoteDate.value,
    unknownHeaders: unknownHeaders.filter((header) => !ITEM_FIELDS.has(normalizeHeader(header))),
    duplicateHeaders,
    expiryDateError: expiryDate.error,
    deliveryNoteDateError: deliveryNoteDate.error,
  };
}

export function normalizeInventoryInputMovement(
  input: Record<string, unknown>,
  rowNumber: number,
  source: InventoryInputMovement["source"] = "receipt",
): InventoryInputMovement {
  const row = normalizeOpeningBatchRow(input, rowNumber);
  return {
    rowNumber,
    itemCode: row.code,
    quantity: row.quantity,
    batchNumber: row.batchNumber,
    expiryDate: row.expiryDate,
    supplier: row.supplier,
    deliveryNoteNumber: row.deliveryNoteNumber,
    deliveryNoteDate: row.deliveryNoteDate,
    notes: normalizeText(input.notes ?? input["ملاحظات"]),
    source,
  };
}

export function createCategoryLookup(categories: Array<{ id: number; name: string }>) {
  return new Map(categories.map((category) => [normalizeLookupValue(category.name), category.id]));
}

export function createUnitLookup(units: readonly string[]) {
  return new Set(units.map(normalizeLookupValue));
}

export function validateInventoryImportRow(
  row: InventoryImportRow,
  context: InventoryImportContext,
  isEmpty = false,
): InventoryImportDecision {
  const errors: InventoryImportIssue[] = [];
  const warnings: InventoryImportIssue[] = [];
  const existingItem = row.code ? context.existingByCode.get(row.code) ?? null : null;

  if (isEmpty) {
    return {
      state: "empty",
      action: "none",
      createsOpeningBatch: false,
      errors,
      warnings,
      row,
      existingItem: null,
    };
  }

  if (row.name.length < 2) {
    errors.push({ code: "NAME_REQUIRED", message: "اسم المادة مطلوب (حرفان على الأقل)" });
  }
  if (!row.unit) errors.push({ code: "UNIT_REQUIRED", message: "الوحدة مطلوبة" });
  if (row.currentStock === null) {
    errors.push({ code: "INVALID_STOCK", message: "الكمية الافتتاحية يجب أن تكون عددًا صحيحًا غير سالب" });
  }
  if (row.minStock === null) {
    errors.push({ code: "INVALID_MIN_STOCK", message: "الحد الأدنى يجب أن يكون عددًا صحيحًا غير سالب" });
  }
  if (row.dateError) errors.push({ code: "INVALID_DATE", message: row.dateError });
  if (row.duplicateHeaders.length) {
    errors.push({
      code: "DUPLICATE_HEADER",
      message: `رؤوس مكررة: ${row.duplicateHeaders.join("، ")}`,
    });
  }
  if (row.unknownHeaders.length) {
    warnings.push({
      code: "UNKNOWN_HEADER",
      message: `أعمدة غير معروفة: ${row.unknownHeaders.join("، ")}`,
    });
  }

  if (row.categoryName && !context.categories.has(normalizeLookupValue(row.categoryName))) {
    errors.push({ code: "UNKNOWN_CATEGORY", message: `التصنيف غير موجود: ${row.categoryName}` });
  }
  if (row.unit && context.units && !context.units.has(normalizeLookupValue(row.unit))) {
    errors.push({ code: "UNKNOWN_UNIT", message: `الوحدة غير معروفة: ${row.unit}` });
  }
  if (row.code && context.seenCodes?.has(row.code)) {
    errors.push({ code: "DUPLICATE_CODE_IN_FILE", message: `الرمز مكرر داخل الملف: ${row.code}` });
  }
  if (row.code && existingItem && context.mode === "insert") {
    errors.push({
      code: "DUPLICATE_CODE",
      message: "الرمز مستخدم مسبقًا — استخدم وضع التحديث والإضافة",
    });
  }

  const openingQuantity = row.currentStock ?? 0;
  if (existingItem && openingQuantity > 0) {
    errors.push({
      code: "STOCK_CHANGE_NOT_ALLOWED",
      message: "لا يمكن تغيير رصيد مادة موجودة من استيراد التعريفات؛ استخدم حركة إدخال أو تسوية",
    });
  }
  if (existingItem?.requiresExpiryTracking && openingQuantity > 0 && !row.expiryDate) {
    errors.push({
      code: "EXPIRY_REQUIRED",
      message: "هذه المادة تتطلب تاريخ صلاحية للدفعة الافتتاحية",
    });
  }
  if (existingItem?.requiresBatchTracking && openingQuantity > 0 && !row.batchNumber) {
    errors.push({
      code: "BATCH_REQUIRED",
      message: "هذه المادة تتطلب رقم دفعة للدفعة الافتتاحية",
    });
  }
  if (existingItem && (row.expiryDate || row.batchNumber || row.supplier)) {
    warnings.push({
      code: "LEGACY_BATCH_FIELDS_IGNORED",
      message: "بيانات الدفعة في صف مادة موجودة لا تغيّر سجل الدفعات؛ استخدم ورقة الدفعات الافتتاحية",
    });
  }

  const action = errors.length ? "none" : existingItem ? "update-item" : "create-item";
  return {
    state: errors.length ? "error" : warnings.length ? "warning" : "valid",
    action,
    createsOpeningBatch: !errors.length && !existingItem && openingQuantity > 0,
    errors,
    warnings,
    row,
    existingItem,
  };
}

export function validateInventoryOpeningBatchRow(
  row: InventoryOpeningBatchRow,
  context: InventoryOpeningBatchContext,
  isEmpty = false,
): InventoryOpeningBatchDecision {
  const errors: InventoryImportIssue[] = [];
  const warnings: InventoryImportIssue[] = [];
  const existingItem = row.code ? context.existingByCode.get(row.code) ?? null : null;

  if (isEmpty) {
    return { state: "empty", action: "none", errors, warnings, row, existingItem: null };
  }

  if (!row.code) errors.push({ code: "ITEM_CODE_REQUIRED", message: "رمز المادة مطلوب" });
  if (row.quantity === null || row.quantity <= 0) {
    errors.push({ code: "INVALID_OPENING_QUANTITY", message: "الكمية الافتتاحية يجب أن تكون عددًا صحيحًا أكبر من الصفر" });
  }
  if (!existingItem && row.code) {
    errors.push({ code: "UNKNOWN_ITEM_CODE", message: `رمز المادة غير موجود: ${row.code}` });
  }
  if (row.expiryDateError) errors.push({ code: "INVALID_DATE", message: row.expiryDateError });
  if (row.deliveryNoteDateError) {
    errors.push({ code: "INVALID_DELIVERY_NOTE_DATE", message: row.deliveryNoteDateError });
  }
  if (row.duplicateHeaders.length) {
    errors.push({
      code: "DUPLICATE_HEADER",
      message: `رؤوس مكررة: ${row.duplicateHeaders.join("، ")}`,
    });
  }
  if (row.unknownHeaders.length) {
    warnings.push({
      code: "UNKNOWN_HEADER",
      message: `أعمدة غير معروفة: ${row.unknownHeaders.join("، ")}`,
    });
  }
  if (existingItem?.requiresExpiryTracking && !row.expiryDate) {
    errors.push({ code: "EXPIRY_REQUIRED", message: "هذه المادة تتطلب تاريخ صلاحية للدفعة" });
  }
  if (existingItem?.requiresBatchTracking && !row.batchNumber) {
    errors.push({ code: "BATCH_REQUIRED", message: "هذه المادة تتطلب رقم دفعة" });
  }

  const batchKey = [
    row.code ?? "",
    row.batchNumber ?? "",
    row.expiryDate ?? "",
    row.deliveryNoteNumber ?? "",
  ].join("|");
  if (context.seenBatchKeys?.has(batchKey)) {
    errors.push({ code: "DUPLICATE_BATCH_IN_FILE", message: "الدفعة مكررة داخل الملف" });
  }
  const existingBatch = context.existingBatchKeys?.has(batchKey) ?? false;
  if (existingBatch && errors.length === 0) {
    warnings.push({
      code: "DUPLICATE_EXISTING_BATCH",
      message: "الدفعة موجودة مسبقًا؛ سيتم تجاهلها في وضع التحديث دون تغيير الرصيد",
    });
  }

  return {
    state: errors.length ? "error" : warnings.length ? "warning" : "valid",
    action: errors.length
      ? "none"
      : existingBatch
        ? "skip-existing-batch"
        : "create-opening-batch",
    errors,
    warnings,
    row,
    existingItem,
    skipExistingBatch: existingBatch && errors.length === 0,
  };
}

export function validateInventoryImportRows(
  inputs: Array<Record<string, unknown>>,
  context: Omit<InventoryImportContext, "seenCodes">,
) {
  const seenCodes = new Set<string>();
  return inputs.map((input, index) => {
    const row = normalizeInventoryRow(input, index + 2);
    const decision = validateInventoryImportRow(row, { ...context, seenCodes }, !hasInputValue(input));
    if (row.code) seenCodes.add(row.code);
    return decision;
  });
}

export function validateInventoryOpeningBatchRows(
  inputs: Array<Record<string, unknown>>,
  context: Omit<InventoryOpeningBatchContext, "seenBatchKeys">,
) {
  const seenBatchKeys = new Set<string>();
  return inputs.map((input, index) => {
    const row = normalizeOpeningBatchRow(input, index + 2);
    const decision = validateInventoryOpeningBatchRow(
      row,
      { ...context, seenBatchKeys },
      !hasInputValue(input),
    );
    const key = [
      row.code ?? "",
      row.batchNumber ?? "",
      row.expiryDate ?? "",
      row.deliveryNoteNumber ?? "",
    ].join("|");
    if (row.code) seenBatchKeys.add(key);
    return decision;
  });
}