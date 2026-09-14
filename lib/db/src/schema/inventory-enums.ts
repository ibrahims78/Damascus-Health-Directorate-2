/**
 * Stable database values for the phase-one inventory foundation.
 *
 * These are deliberately stored as text values instead of PostgreSQL enums so
 * that future business decisions can be introduced through additive
 * migrations without rewriting existing rows.
 */
export const SUPPLY_SOURCES = ["central_warehouses"] as const;
export type SupplySource = (typeof SUPPLY_SOURCES)[number];

export const DELIVERY_DESTINATIONS = [
  "administrative_building",
  "health_facility",
  // Kept for importing and reading records created by older releases.
  "ambulance_point",
] as const;
export type DeliveryDestination = (typeof DELIVERY_DESTINATIONS)[number];

export const TRANSACTION_TYPES = [
  "in",
  "out",
  "init",
  "adjust",
  "custody_out",
  "custody_return",
  "damage",
  "central_return",
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const CUSTODY_STATUSES = [
  "open",
  "partially_returned",
  "returned",
  "damaged",
  "closed",
] as const;
export type CustodyStatus = (typeof CUSTODY_STATUSES)[number];

export const RETURN_CONDITIONS = [
  "good",
  "damaged",
  "needs_maintenance",
  "missing",
] as const;
export type ReturnCondition = (typeof RETURN_CONDITIONS)[number];

export const ITEM_TYPES = ["item", "equipment"] as const;
export type InventoryItemType = (typeof ITEM_TYPES)[number];