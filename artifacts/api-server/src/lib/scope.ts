export type ScopedUser = { role?: string | null; warehouseId?: number | null } | null | undefined;

/**
 * The warehouse a user is confined to (audit P0-4).
 *
 * Admins always see every site, and a user without an assigned warehouse keeps
 * full access (the previous behaviour), so existing installations are unaffected
 * until an administrator actually assigns a warehouse.
 */
export function scopedWarehouseId(user: ScopedUser): number | null {
  if (!user) return null;
  if (user.role === "admin") return null;
  const id = Number(user.warehouseId);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** True when the row belongs to the caller's warehouse (or the caller is unscoped). */
export function withinScope(user: ScopedUser, warehouseId: unknown): boolean {
  const scope = scopedWarehouseId(user);
  if (scope === null) return true;
  return Number(warehouseId) === scope;
}

/** A warehouse chosen in the request must never escape the caller's scope. */
export function resolveScopedWarehouse(user: ScopedUser, requested: unknown, fallback: number): number {
  const scope = scopedWarehouseId(user);
  const wanted = Number(requested);
  if (scope !== null) return scope;
  return Number.isSafeInteger(wanted) && wanted > 0 ? wanted : fallback;
}
