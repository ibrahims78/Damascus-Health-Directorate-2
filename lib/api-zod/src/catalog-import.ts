/**
 * Catalog import contract (materials + equipment definitions).
 *
 * Hard rule: the catalog template carries NO quantity columns. Balances and
 * batches belong to movements, never to the catalog. This module is pure
 * (no database access) so it runs identically on the server and offline.
 */

export const CATALOG_TEMPLATE_VERSION = "1.0";

export const CATALOG_SHEET_NAMES = {
  items: "المواد",
  equipment: "التجهيزات",
  references: "القيم المرجعية",
  instructions: "التعليمات",
} as const;

/** Canonical column keys for each sheet. */
export const CATALOG_ITEM_COLUMNS = [
  "code",
  "name",
  "category",
  "unit",
  "minStock",
  "requiresBatch",
  "requiresExpiry",
  "location",
  "supplier",
  "notes",
  "active",
] as const;

export const CATALOG_EQUIPMENT_COLUMNS = [
  "code",
  "name",
  "equipmentType",
  "company",
  "model",
  "serialNumber",
  "unit",
  "quantity",
  "warehouse",
  "minQuantity",
  "requiresSerial",
  "notes",
  "active",
] as const;

/** Arabic headers used in the generated template and accepted while parsing. */
export const CATALOG_ITEM_HEADERS: Record<(typeof CATALOG_ITEM_COLUMNS)[number], string> = {
  code: "الرمز",
  name: "الاسم",
  category: "التصنيف",
  unit: "الوحدة",
  minStock: "الحد الأدنى",
  requiresBatch: "يتطلب دفعة",
  requiresExpiry: "يتطلب صلاحية",
  location: "الموقع",
  supplier: "المورد",
  notes: "ملاحظات",
  active: "فعّال",
};

export const CATALOG_EQUIPMENT_HEADERS: Record<(typeof CATALOG_EQUIPMENT_COLUMNS)[number], string> = {
  code: "الرمز",
  name: "الاسم",
  equipmentType: "النوع",
  company: "الشركة",
  model: "الموديل",
  serialNumber: "الرقم التسلسلي",
  unit: "الوحدة",
  quantity: "الكمية",
  warehouse: "المستودع",
  minQuantity: "الحد الأدنى",
  requiresSerial: "يتطلب رقم تسلسلي",
  notes: "ملاحظات",
  active: "فعّال",
};

export type CatalogIssueCode =
  | "NAME_REQUIRED"
  | "UNIT_REQUIRED"
  | "UNIT_UNKNOWN"
  | "CATEGORY_UNKNOWN"
  | "DUP_KEY_IN_FILE"
  | "DUP_KEY_EXISTING"
  | "SERIAL_WITH_QUANTITY"
  | "INVALID_ACTIVE_FLAG"
  | "INVALID_NUMBER"
  | "SERIAL_WITH_QTY_COLUMN"
  | "WAREHOUSE_REQUIRED"
  | "WAREHOUSE_UNKNOWN";

export type CatalogIssue = {
  sheet: "items" | "equipment";
  row: number;
  field?: string;
  code: CatalogIssueCode;
  message: string;
  severity: "error" | "warning";
};

export type CatalogRowDecision<T> = {
  row: number;
  action: "create" | "update" | "skip" | "error";
  key: string;
  data: T;
  issues: CatalogIssue[];
};

export type CatalogAnalysis<T> = {
  rows: CatalogRowDecision<T>[];
  summary: { total: number; create: number; update: number; skip: number; error: number };
};

export type CatalogItemRow = {
  code: string | null;
  name: string;
  category: string | null;
  unit: string;
  minStock: number;
  requiresBatch: boolean;
  requiresExpiry: boolean;
  location: string | null;
  supplier: string | null;
  notes: string | null;
  active: boolean;
};

export type CatalogEquipmentRow = {
  code: string | null;
  name: string;
  equipmentType: string | null;
  company: string | null;
  model: string | null;
  serialNumber: string | null;
  unit: string | null;
  quantity: number;
  warehouse: string | null;
  minQuantity: number;
  requiresSerial: boolean;
  notes: string | null;
  active: boolean;
};

export type CatalogImportMode = "add-only" | "add-and-update";

export type CatalogValidationContext = {
  knownUnits: ReadonlySet<string>;
  knownCategories: ReadonlySet<string>;
  knownWarehouseCodes: ReadonlySet<string>;
  existingItemKeys: ReadonlySet<string>;
  existingEquipmentKeys: ReadonlySet<string>;
  mode: CatalogImportMode;
};

/** True/false parsing that accepts Arabic and English spellings. */
export function parseBooleanFlag(value: unknown, fallback = false): boolean | null {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "نعم", "صح", "فعّال", "فعال", "نشط"].includes(text)) return true;
  if (["0", "false", "no", "n", "لا", "خطأ", "غير فعّال", "غير فعال", "غير نشط"].includes(text)) return false;
  return null;
}

export function parseInteger(value: unknown): number | null {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const n = Number(String(value).trim());
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

const norm = (value: unknown) => String(value ?? "").trim();

/** Materials are keyed by code, otherwise by (name + unit). */
export function itemKey(row: CatalogItemRow): string {
  return row.code ? `code:${row.code}` : `name:${row.name}|unit:${row.unit}`;
}

/** Equipment is keyed by serial number, otherwise by (name + model). */
export function equipmentKey(row: CatalogEquipmentRow): string {
  if (row.serialNumber) return `serial:${row.serialNumber}`;
  return `name:${row.name}|model:${row.model ?? ""}`;
}

function finalize<T>(rows: CatalogRowDecision<T>[]): CatalogAnalysis<T> {
  const summary = { total: rows.length, create: 0, update: 0, skip: 0, error: 0 };
  for (const row of rows) {
    if (row.action === "create") summary.create += 1;
    else if (row.action === "update") summary.update += 1;
    else if (row.action === "skip") summary.skip += 1;
    else summary.error += 1;
  }
  return { rows, summary };
}

export function validateCatalogItemRows(
  rawRows: Array<Record<string, unknown>>,
  ctx: CatalogValidationContext,
): CatalogAnalysis<CatalogItemRow> {
  const seen = new Set<string>();
  const decisions: CatalogRowDecision<CatalogItemRow>[] = [];

  rawRows.forEach((raw, index) => {
    const rowNumber = index + 2; // +1 header, +1 one-based
    const issues: CatalogIssue[] = [];
    const push = (code: CatalogIssueCode, message: string, field?: string, severity: CatalogIssue["severity"] = "error") =>
      issues.push({ sheet: "items", row: rowNumber, field, code, message, severity });

    const name = norm(raw.name ?? raw["الاسم"]);
    if (!name) push("NAME_REQUIRED", "اسم المادة مطلوب.", "name");

    const unit = norm(raw.unit ?? raw["الوحدة"]);
    if (!unit) push("UNIT_REQUIRED", "وحدة القياس مطلوبة.", "unit");
    else if (!ctx.knownUnits.has(unit)) push("UNIT_UNKNOWN", `الوحدة «${unit}» غير معرّفة في كتالوج الوحدات.`, "unit");

    const category = norm(raw.category ?? raw["التصنيف"]) || null;
    if (category && !ctx.knownCategories.has(category)) {
      push("CATEGORY_UNKNOWN", `التصنيف «${category}» غير معرّف.`, "category");
    }

    if (raw.quantity !== undefined || raw["الكمية"] !== undefined) {
      push("SERIAL_WITH_QTY_COLUMN", "قالب الكتالوج لا يقبل أعمدة كمية؛ الرصيد يُدار بالحركات.", "quantity");
    }

    const minStockRaw = parseInteger(raw.minStock ?? raw["الحد الأدنى"]);
    if (minStockRaw === null && norm(raw.minStock ?? raw["الحد الأدنى"]) !== "") {
      push("INVALID_NUMBER", "الحد الأدنى يجب أن يكون عددًا صحيحًا.", "minStock");
    }

    const active = parseBooleanFlag(raw.active ?? raw["فعّال"], true);
    if (active === null) push("INVALID_ACTIVE_FLAG", "قيمة «فعّال» يجب أن تكون نعم/لا.", "active");

    const row: CatalogItemRow = {
      code: norm(raw.code ?? raw["الرمز"]) || null,
      name,
      category,
      unit,
      minStock: minStockRaw ?? 0,
      requiresBatch: parseBooleanFlag(raw.requiresBatch ?? raw["يتطلب دفعة"], false) ?? false,
      requiresExpiry: parseBooleanFlag(raw.requiresExpiry ?? raw["يتطلب صلاحية"], false) ?? false,
      location: norm(raw.location ?? raw["الموقع"]) || null,
      supplier: norm(raw.supplier ?? raw["المورد"]) || null,
      notes: norm(raw.notes ?? raw["ملاحظات"]) || null,
      active: active ?? true,
    };

    const key = itemKey(row);
    if (seen.has(key)) push("DUP_KEY_IN_FILE", "سطر مكرر داخل الملف بنفس المفتاح.", "code");
    seen.add(key);

    const exists = ctx.existingItemKeys.has(key);
    if (exists && ctx.mode === "add-only") {
      push("DUP_KEY_EXISTING", "الصنف موجود مسبقًا (وضع الإضافة فقط).", "code", "warning");
    }

    const hasError = issues.some((i) => i.severity === "error");
    const action: CatalogRowDecision<CatalogItemRow>["action"] = hasError
      ? "error"
      : exists
        ? ctx.mode === "add-and-update"
          ? "update"
          : "skip"
        : "create";

    decisions.push({ row: rowNumber, action, key, data: row, issues });
  });

  return finalize(decisions);
}

export function validateCatalogEquipmentRows(
  rawRows: Array<Record<string, unknown>>,
  ctx: CatalogValidationContext,
): CatalogAnalysis<CatalogEquipmentRow> {
  const seen = new Set<string>();
  const decisions: CatalogRowDecision<CatalogEquipmentRow>[] = [];

  rawRows.forEach((raw, index) => {
    const rowNumber = index + 2;
    const issues: CatalogIssue[] = [];
    const push = (code: CatalogIssueCode, message: string, field?: string, severity: CatalogIssue["severity"] = "error") =>
      issues.push({ sheet: "equipment", row: rowNumber, field, code, message, severity });

    const name = norm(raw.name ?? raw["الاسم"]);
    if (!name) push("NAME_REQUIRED", "اسم التجهيز مطلوب.", "name");

    const quantityRaw = parseInteger(raw.quantity ?? raw["الكمية"]);
    if (quantityRaw === null && norm(raw.quantity ?? raw["الكمية"]) !== "") {
      push("INVALID_NUMBER", "الكمية يجب أن تكون عددًا صحيحًا.", "quantity");
    }
    if (quantityRaw !== null && quantityRaw < 1) {
      push("INVALID_NUMBER", "الكمية يجب أن تكون 1 على الأقل.", "quantity");
    }

    const serialNumber = norm(raw.serialNumber ?? raw["الرقم التسلسلي"]) || null;
    if (serialNumber && quantityRaw !== null && quantityRaw !== 1) {
      push("SERIAL_WITH_QUANTITY", "التجهيز ذو الرقم التسلسلي كميته = 1 دائماً.", "quantity");
    }

    const warehouse = norm(raw.warehouse ?? raw["المستودع"]) || null;
    if (!warehouse) {
      push("WAREHOUSE_REQUIRED", "المستودع مطلوب للتجهيز.", "warehouse");
    } else if (!ctx.knownWarehouseCodes.has(warehouse)) {
      push("WAREHOUSE_UNKNOWN", `المستودع «${warehouse}» غير معرّف.`, "warehouse");
    }

    const minQuantityRaw = parseInteger(raw.minQuantity ?? raw["الحد الأدنى"]);
    if (minQuantityRaw === null && norm(raw.minQuantity ?? raw["الحد الأدنى"]) !== "") {
      push("INVALID_NUMBER", "الحد الأدنى يجب أن يكون عددًا صحيحًا.", "minQuantity");
    }

    const active = parseBooleanFlag(raw.active ?? raw["فعّال"], true);
    if (active === null) push("INVALID_ACTIVE_FLAG", "قيمة «فعّال» يجب أن تكون نعم/لا.", "active");

    const unitRaw = norm(raw.unit ?? raw["الوحدة"]) || null;
    if (unitRaw && !ctx.knownUnits.has(unitRaw)) {
      push("UNIT_UNKNOWN", `الوحدة «${unitRaw}» غير معرّفة في كتالوج الوحدات.`, "unit", "warning");
    }

    const row: CatalogEquipmentRow = {
      code: norm(raw.code ?? raw["الرمز"]) || null,
      name,
      equipmentType: norm(raw.equipmentType ?? raw["النوع"]) || null,
      company: norm(raw.company ?? raw["الشركة"]) || null,
      model: norm(raw.model ?? raw["الموديل"]) || null,
      serialNumber,
      unit: unitRaw,
      quantity: serialNumber ? 1 : quantityRaw ?? 1,
      warehouse,
      minQuantity: minQuantityRaw ?? 0,
      requiresSerial: parseBooleanFlag(raw.requiresSerial ?? raw["يتطلب رقم تسلسلي"], Boolean(serialNumber)) ?? Boolean(serialNumber),
      notes: norm(raw.notes ?? raw["ملاحظات"]) || null,
      active: active ?? true,
    };

    const key = equipmentKey(row);
    if (seen.has(key)) push("DUP_KEY_IN_FILE", "سطر مكرر داخل الملف بنفس المفتاح.", "serialNumber");
    seen.add(key);

    const exists = ctx.existingEquipmentKeys.has(key);
    if (exists && ctx.mode === "add-only") {
      push("DUP_KEY_EXISTING", "التجهيز موجود مسبقًا (وضع الإضافة فقط).", "serialNumber", "warning");
    }

    const hasError = issues.some((i) => i.severity === "error");
    const action: CatalogRowDecision<CatalogEquipmentRow>["action"] = hasError
      ? "error"
      : exists
        ? ctx.mode === "add-and-update"
          ? "update"
          : "skip"
        : "create";

    decisions.push({ row: rowNumber, action, key, data: row, issues });
  });

  return finalize(decisions);
}
