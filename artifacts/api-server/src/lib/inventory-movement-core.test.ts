/**
 * Unit tests for the pure inventory-movement math (approved plan phase 9):
 * FEFO allocation, custody availability, and input validation. These run in
 * `pnpm test` (vitest) with no database — they guard the highest-risk logic
 * of the movement service against regressions.
 */
import { describe, expect, it } from "vitest";
import {
  allocateBatchesFefo,
  assertEntityReference,
  assertIsoDate,
  assertMeaningfulReason,
  assertNonEmpty,
  assertPositiveInteger,
  calculateEquipmentAvailable,
  InventoryMovementError,
} from "./inventory-movement-core";

const expectError = (fn: () => unknown, code: string) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(InventoryMovementError);
    expect((error as InventoryMovementError).code).toBe(code);
    return;
  }
  throw new Error(`expected InventoryMovementError(${code}) but nothing was thrown`);
};

describe("assertPositiveInteger", () => {
  it("accepts safe positive integers (number or numeric string)", () => {
    expect(assertPositiveInteger(5, "x")).toBe(5);
    expect(assertPositiveInteger("42", "x")).toBe(42);
  });

  it("rejects zero, negatives, decimals and garbage", () => {
    expectError(() => assertPositiveInteger(0, "x"), "INVALID_QUANTITY");
    expectError(() => assertPositiveInteger(-3, "x"), "INVALID_QUANTITY");
    expectError(() => assertPositiveInteger(2.5, "x"), "INVALID_QUANTITY");
    expectError(() => assertPositiveInteger("abc", "x"), "INVALID_QUANTITY");
    expectError(() => assertPositiveInteger(null, "x"), "INVALID_QUANTITY");
  });
});

describe("assertNonEmpty", () => {
  it("trims and returns non-empty values", () => {
    expect(assertNonEmpty("  سبب  ", "reason")).toBe("سبب");
  });

  it("rejects empty/missing with REQUIRED_FIELD", () => {
    expectError(() => assertNonEmpty("", "reason"), "REQUIRED_FIELD");
    expectError(() => assertNonEmpty("   ", "reason"), "REQUIRED_FIELD");
    expectError(() => assertNonEmpty(null, "reason"), "REQUIRED_FIELD");
  });
});

describe("assertMeaningfulReason", () => {
  it("trims and accepts a clear reason", () => {
    expect(assertMeaningfulReason("  تلف مثبت  ", "التلف")).toBe("تلف مثبت");
  });

  it("rejects a too-short reason", () => {
    expectError(() => assertMeaningfulReason("سبب", "التلف"), "REASON_TOO_SHORT");
  });
});

describe("assertIsoDate", () => {
  it("accepts valid YYYY-MM-DD dates", () => {
    expect(assertIsoDate("2026-08-27", "documentDate", true)).toBe("2026-08-27");
  });

  it("returns null for empty optional dates", () => {
    expect(assertIsoDate("", "documentDate")).toBeNull();
  });

  it("rejects missing required dates with INVALID_DATE", () => {
    expectError(() => assertIsoDate("", "documentDate", true), "INVALID_DATE");
  });

  it("rejects malformed formats and impossible dates", () => {
    expectError(() => assertIsoDate("27-08-2026", "documentDate", true), "INVALID_DATE");
    expectError(() => assertIsoDate("2026-02-30", "documentDate", true), "INVALID_DATE");
    expectError(() => assertIsoDate("yesterday", "documentDate", true), "INVALID_DATE");
  });
});

describe("assertEntityReference", () => {
  it("resolves an item reference", () => {
    expect(assertEntityReference("item", 12, null)).toEqual({
      itemType: "item",
      itemId: 12,
      equipmentId: null,
    });
  });

  it("resolves an equipment reference", () => {
    expect(assertEntityReference("equipment", null, "7")).toEqual({
      itemType: "equipment",
      itemId: null,
      equipmentId: 7,
    });
  });

  it("rejects mismatched entity references with ENTITY_TYPE_MISMATCH", () => {
    expectError(() => assertEntityReference("item", 12, 7), "ENTITY_TYPE_MISMATCH");
    expectError(() => assertEntityReference("item", null, null), "ENTITY_TYPE_MISMATCH");
    expectError(() => assertEntityReference("equipment", 12, null), "ENTITY_TYPE_MISMATCH");
    expectError(() => assertEntityReference("equipment", null, null), "ENTITY_TYPE_MISMATCH");
  });

  it("rejects unknown item types with INVALID_ITEM_TYPE", () => {
    expectError(() => assertEntityReference("vehicle", 12, null), "INVALID_ITEM_TYPE");
  });
});

describe("allocateBatchesFefo", () => {
  const batches = [
    { id: 1, remainingQuantity: 5, expiryDate: "2026-12-01", batchNumber: "B1" },
    { id: 2, remainingQuantity: 8, expiryDate: "2026-09-01", batchNumber: "B2" },
    { id: 3, remainingQuantity: 4, expiryDate: null, batchNumber: "B3" },
    { id: 4, remainingQuantity: 6, expiryDate: "2026-01-01", batchNumber: "EXPIRED" },
  ];

  it("allocates the earliest-expiring eligible batches first", () => {
    const allocations = allocateBatchesFefo(batches, 10, "2026-08-29");
    expect(allocations).toEqual([
      { batchId: 2, quantity: 8, batchNumberSnap: "B2", expiryDateSnap: "2026-09-01" },
      { batchId: 1, quantity: 2, batchNumberSnap: "B1", expiryDateSnap: "2026-12-01" },
    ]);
  });

  it("skips expired batches entirely", () => {
    const allocations = allocateBatchesFefo(batches, 6, "2026-08-29");
    expect(allocations.some((a) => a.batchId === 4)).toBe(false);
  });

  it("orders batches without an expiry date last", () => {
    const allocations = allocateBatchesFefo(batches, 14, "2026-08-29");
    expect(allocations.map((a) => a.batchId)).toEqual([2, 1, 3]);
  });

  it("rejects requests exceeding eligible stock with INSUFFICIENT_BATCH_STOCK", () => {
    expectError(
      () => allocateBatchesFefo(batches, 20, "2026-08-29"),
      "INSUFFICIENT_BATCH_STOCK",
    );
  });

  it("treats dated batches as expired when the clock passes all expiries", () => {
    // Batch 3 (no expiry) is always eligible with 4 units — requesting more
    // than that must fail with INSUFFICIENT_BATCH_STOCK.
    expectError(
      () => allocateBatchesFefo(batches, 5, "2027-01-01"),
      "INSUFFICIENT_BATCH_STOCK",
    );
    expect(allocateBatchesFefo(batches, 4, "2027-01-01").map((a) => a.batchId)).toEqual([3]);
  });

  it("rejects invalid requested quantities", () => {
    expectError(() => allocateBatchesFefo(batches, 0, "2026-08-29"), "INVALID_QUANTITY");
  });
});

describe("calculateEquipmentAvailable", () => {
  it("subtracts open custody from the total", () => {
    expect(calculateEquipmentAvailable(10, 3)).toBe(7);
  });

  it("never returns below zero", () => {
    expect(calculateEquipmentAvailable(2, 5)).toBe(0);
  });

  it("handles an empty custody ledger", () => {
    expect(calculateEquipmentAvailable(4, 0)).toBe(4);
  });
});
