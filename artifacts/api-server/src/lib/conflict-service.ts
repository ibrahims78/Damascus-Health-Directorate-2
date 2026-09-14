import { and, asc, eq } from "drizzle-orm";
import {
  db,
  syncChangeLogTable,
  syncConflictTable,
} from "@workspace/db";
import { ensureNodeIdentity, recordLocalChange } from "./sync-service";
import { materializeSingleChange } from "./sync-apply-service";

export async function listSyncConflicts(status: "open" | "resolved" | "deferred" | "all" = "open") {
  const rows = await db
    .select({
      conflict: syncConflictTable,
      change: syncChangeLogTable,
    })
    .from(syncConflictTable)
    .leftJoin(syncChangeLogTable, eq(syncChangeLogTable.changeId, syncConflictTable.changeId))
    .where(status === "all" ? undefined : eq(syncConflictTable.status, status))
    .orderBy(asc(syncConflictTable.createdAt));
  return rows;
}

export async function resolveSyncConflict(input: {
  conflictId: number;
  userId: number;
  resolution: "approve" | "reject" | "correct" | "defer";
  correction?: Record<string, unknown>;
}) {
  if (input.resolution === "correct" && !input.correction) {
    throw new Error("SYNC_CORRECTION_REQUIRED");
  }
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ conflict: syncConflictTable, change: syncChangeLogTable })
      .from(syncConflictTable)
      .leftJoin(syncChangeLogTable, eq(syncChangeLogTable.changeId, syncConflictTable.changeId))
      .where(eq(syncConflictTable.id, input.conflictId))
      .limit(1);
    if (!row) throw new Error("SYNC_CONFLICT_NOT_FOUND");
    if (row.conflict.status === "resolved") return row.conflict;
    if (!row.change) throw new Error("SYNC_CONFLICT_CHANGE_NOT_FOUND");

    let resolution = input.resolution;

    if (input.resolution === "approve") {
      // Materialize the incoming change into business tables (retry). The
      // change carries a full snapshot, so a missing base row is recovered.
      await materializeSingleChange(tx, {
        changeId: row.change.changeId,
        operationId: row.change.operationId,
        entityType: row.change.entityType,
        entityGlobalId: row.change.entityGlobalId,
        localEntityId: row.change.localEntityId,
        changeType: row.change.changeType as "create" | "update" | "delete",
        payload: row.change.payload as Record<string, unknown>,
        originNodeId: row.change.originNodeId,
        originSequence: row.change.originSequence,
        parentRevision: row.change.parentRevision,
      }, input.userId);
      await tx
        .update(syncChangeLogTable)
        .set({ status: "applied", rejectionCode: null, appliedAt: new Date() })
        .where(eq(syncChangeLogTable.changeId, row.change.changeId));
      resolution = "approve";
    } else if (input.resolution === "reject") {
      // Explicit rejection — the change is excluded from every future
      // package (prepareOutgoingChanges filters rejected rows).
      await tx
        .update(syncChangeLogTable)
        .set({ status: "rejected", rejectionCode: "CONFLICT_REJECTED", appliedAt: new Date() })
        .where(eq(syncChangeLogTable.changeId, row.change.changeId));
      resolution = "reject";
    } else if (input.resolution === "correct") {
      const node = await ensureNodeIdentity("web");
      await recordLocalChange(tx, {
        nodeId: node.nodeId,
        entityType: row.change.entityType,
        globalId: row.change.entityGlobalId,
        changeType: "correction",
        payload: input.correction!,
        parentRevision: row.change.parentRevision,
      });
      // Materialize the correction immediately so the local state reflects
      // the decision (the correction also propagates through the change log).
      await materializeSingleChange(tx, {
        changeId: row.change.changeId,
        operationId: row.change.operationId,
        entityType: row.change.entityType,
        entityGlobalId: row.change.entityGlobalId,
        localEntityId: row.change.localEntityId,
        changeType: "correction",
        payload: input.correction!,
        originNodeId: row.change.originNodeId,
        originSequence: row.change.originSequence,
        parentRevision: row.change.parentRevision,
      }, input.userId);
      resolution = "correct";
    }

    const [updated] = await tx
      .update(syncConflictTable)
      .set({
        status: resolution === "defer" ? "deferred" : "resolved",
        resolvedBy: input.userId,
        resolution,
        resolvedAt: resolution === "defer" ? null : new Date(),
      })
      .where(and(eq(syncConflictTable.id, input.conflictId), eq(syncConflictTable.status, "open")))
      .returning();
    if (!updated) throw new Error("SYNC_CONFLICT_ALREADY_RESOLVED");
    return updated;
  });
}
