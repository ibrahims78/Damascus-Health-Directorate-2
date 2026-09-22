import { describe, expect, it } from "vitest";
import {
  equipmentKey,
  itemKey,
  parseBooleanFlag,
  parseInteger,
  validateCatalogEquipmentRows,
  validateCatalogItemRows,
} from "./catalog-import";

const ctx = {
  knownUnits: new Set(["قطعة", "علبة"]),
  knownCategories: new Set(["مستهلكات"]),
  knownWarehouseCodes: new Set(["C", "WH-2"]),
  existingItemKeys: new Set(["code:ITM-1"]),
  existingEquipmentKeys: new Set<string>(),
  mode: "add-and-update" as const,
};

describe("catalog import contract", () => {
  it("parses Arabic booleans and integers", () => {
    expect(parseBooleanFlag("نعم")).toBe(true);
    expect(parseBooleanFlag("لا")).toBe(false);
    expect(parseBooleanFlag("")).toBe(false);
    expect(parseInteger("12")).toBe(12);
    expect(parseInteger("")).toBeNull();
  });

  it("validates a material row and reports unknown units/categories", () => {
    const analysis = validateCatalogItemRows(
      [{ "الاسم": "مادة أ", "الوحدة": " قطعة ", "التصنيف": "مستهلكات", "الحد الأدنى": "5" }],
      ctx,
    );
    expect(analysis.summary.error).toBe(0);
    expect(analysis.rows[0].action).toBe("create");
    expect(analysis.rows[0].data.unit).toBe("قطعة");
    expect(analysis.rows[0].data.minStock).toBe(5);

    const bad = validateCatalogItemRows([{ "الاسم": "مادة ب", "الوحدة": "كيلو", "التصنيف": "غير معروف" }], ctx);
    const codes = bad.rows[0].issues.map((i) => i.code);
    expect(codes).toContain("UNIT_UNKNOWN");
    expect(codes).toContain("CATEGORY_UNKNOWN");
    expect(bad.rows[0].action).toBe("error");
  });

  it("marks existing keys as update in add-and-update mode and rejects duplicates in file", () => {
    const rows = [
      { "الرمز": "ITM-1", "الاسم": "مادة موجودة", "الوحدة": "قطعة" },
      { "الرمز": "ITM-1", "الاسم": "مادة مكررة", "الوحدة": "قطعة" },
    ];
    const analysis = validateCatalogItemRows(rows, ctx);
    expect(analysis.rows[1].issues.map((i) => i.code)).toContain("DUP_KEY_IN_FILE");
  });

  it("rejects quantity columns in a catalog sheet", () => {
    const analysis = validateCatalogItemRows([{ "الاسم": "م", "الوحدة": "قطعة", "الكمية": 10 }], ctx);
    expect(analysis.rows[0].issues.map((i) => i.code)).toContain("SERIAL_WITH_QTY_COLUMN");
    expect(analysis.rows[0].action).toBe("error");
    expect(analysis.rows[0].data.minStock).toBe(0);
  });

  it("validates equipment rows and serial keys", () => {
    const analysis = validateCatalogEquipmentRows(
      [{ "الاسم": "جهاز", "الرقم التسلسلي": "SN-9", "الحد الأدنى": "1", "المستودع": "C" }],
      ctx,
    );
    expect(analysis.summary.create).toBe(1);
    expect(analysis.rows[0].data.requiresSerial).toBe(true);
    expect(equipmentKey(analysis.rows[0].data)).toBe("serial:SN-9");

    const withQty = validateCatalogEquipmentRows([{ "الاسم": "جهاز", "الكمية": 4, "المستودع": "C" }], ctx);
    expect(withQty.summary.create).toBe(1);
    expect(withQty.rows[0].data.quantity).toBe(4);

    const noWarehouse = validateCatalogEquipmentRows([{ "الاسم": "جهاز ب" }], ctx);
    expect(noWarehouse.rows[0].issues.map((i) => i.code)).toContain("WAREHOUSE_REQUIRED");

    const badWarehouse = validateCatalogEquipmentRows([{ "الاسم": "جهاز ج", "المستودع": "X" }], ctx);
    expect(badWarehouse.rows[0].issues.map((i) => i.code)).toContain("WAREHOUSE_UNKNOWN");
  });

  it("builds stable keys", () => {
    expect(itemKey({ code: null, name: "م", unit: "قطعة", category: null, minStock: 0, requiresBatch: false, requiresExpiry: false, location: null, supplier: null, notes: null, active: true })).toBe("name:م|unit:قطعة");
    expect(itemKey({ code: "X", name: "م", unit: "قطعة", category: null, minStock: 0, requiresBatch: false, requiresExpiry: false, location: null, supplier: null, notes: null, active: true })).toBe("code:X");
  });
});
