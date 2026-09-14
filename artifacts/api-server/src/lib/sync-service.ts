import { createHash, randomUUID } from "node:crypto";
import {
  db,
  nodeIdentityTable,
  syncChangeLogTable,
  syncConflictTable,
  syncEntityIdsTable,
  syncCursorTable,
  syncInboxTable,
  syncOutboxTable,
  syncSessionPackageTable,
  syncSessionTable,
  syncTombstoneTable,
} from "@workspace/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type {
  SyncChangeStatus,
  SyncChangeType,
  SyncNodeType,
  SyncPackageDirection,
  SyncSessionStatus,
} from "@workspace/db";
import {
  classifyConflictSeverity as classifySeverity,
  materializeChanges,
} from "./sync-apply-service";

type SyncDbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type LocalChangeInput = {
  nodeId: string;
  operationId?: string;
  originSequence?: number;
  entityType: string;
  localEntityId?: number | null;
  globalId?: string;
  changeType: SyncChangeType;
  payload: Record<string, unknown>;
  parentRevision?: string | null;
};

export async function ensureNodeIdentity(nodeType: SyncNodeType = "web") {
  const current = await db.query.nodeIdentityTable.findFirst();
  if (current) return current;

  const values = {
    nodeId: randomUUID(),
    installationId: randomUUID(),
    nodeType,
    keyId: null,
    originSequence: 0,
  } as const;

  try {
    const [created] = await db.insert(nodeIdentityTable).values(values).returning();
    return created;
  } catch (error) {
    // Two startup requests may race on first boot. The unique constraint is
    // the lock; return the winner rather than creating a second identity.
    const winner = await db.query.nodeIdentityTable.findFirst();
    if (winner) return winner;
    throw error;
  }
}

export async function reserveOriginSequence(tx: SyncDbTransaction, nodeId: string) {
  const [updated] = await tx
    .update(nodeIdentityTable)
    .set({
      originSequence: sql`${nodeIdentityTable.originSequence} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(nodeIdentityTable.nodeId, nodeId))
    .returning({ originSequence: nodeIdentityTable.originSequence });

  if (!updated) {
    throw new Error("SYNC_NODE_IDENTITY_NOT_FOUND");
  }
  return updated.originSequence;
}

export async function ensureEntityIdentity(
  tx: SyncDbTransaction,
  entityType: string,
  localId: number,
  requestedGlobalId?: string,
) {
  const [existing] = await tx
    .select()
    .from(syncEntityIdsTable)
    .where(and(eq(syncEntityIdsTable.entityType, entityType), eq(syncEntityIdsTable.localId, localId)))
    .limit(1);
  if (existing) return existing.globalId;

  const globalId = requestedGlobalId ?? randomUUID();
  await tx
    .insert(syncEntityIdsTable)
    .values({ entityType, localId, globalId })
    .onConflictDoNothing();

  const [created] = await tx
    .select({ globalId: syncEntityIdsTable.globalId })
    .from(syncEntityIdsTable)
    .where(and(eq(syncEntityIdsTable.entityType, entityType), eq(syncEntityIdsTable.localId, localId)))
    .limit(1);
  if (!created) throw new Error("SYNC_ENTITY_IDENTITY_NOT_CREATED");
  return created.globalId;
}

export async function recordLocalChange(
  tx: SyncDbTransaction,
  input: LocalChangeInput,
) {
  const operationId = input.operationId ?? randomUUID();
  const changeId = randomUUID();
  const globalId =
    input.globalId ??
    (input.localEntityId == null
      ? randomUUID()
      : await ensureEntityIdentity(tx, input.entityType, input.localEntityId));

  await tx.insert(syncChangeLogTable).values({
    changeId,
    operationId,
    entityType: input.entityType,
    entityGlobalId: globalId,
    localEntityId: input.localEntityId ?? null,
    changeType: input.changeType,
    payload: input.payload,
    originNodeId: input.nodeId,
    originSequence:
      input.originSequence ?? (await reserveOriginSequence(tx, input.nodeId)),
    parentRevision: input.parentRevision ?? null,
    status: "local-pending",
  });

  await tx.insert(syncOutboxTable).values({ changeId, status: "pending" });
  return { changeId, operationId, globalId };
}

export type SyncVector = Record<string, number>;

export type SyncChange = {
  changeId: string;
  operationId: string;
  entityType: string;
  entityGlobalId: string;
  localEntityId: number | null;
  changeType: SyncChangeType;
  payload: Record<string, unknown>;
  originNodeId: string;
  originSequence: number;
  causedByChangeId?: string | null;
  parentRevision: string | null;
  createdAt?: string | Date | null;
  status?: string | null;
};

export type SyncPackageReport = {
  packageId: string;
  contentHash: string;
  counts: {
    received: number;
    applied: number;
    duplicate: number;
    conflicts: number;
    rejected: number;
  };
  baseVector: SyncVector;
  lastVector: SyncVector;
  status: "applied" | "partially-applied" | "failed";
  errorCode?: string;
};

function asVector(value: unknown): SyncVector {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const vector: SyncVector = {};
  for (const [nodeId, sequence] of Object.entries(value)) {
    const number = Number(sequence);
    if (nodeId && Number.isSafeInteger(number) && number >= 0) vector[nodeId] = number;
  }
  return vector;
}

function mergeVector(...vectors: SyncVector[]): SyncVector {
  const result: SyncVector = {};
  for (const vector of vectors) {
    for (const [nodeId, sequence] of Object.entries(vector)) {
      result[nodeId] = Math.max(result[nodeId] ?? 0, sequence);
    }
  }
  return result;
}

function changeToContract(row: {
  changeId: string;
  operationId: string;
  entityType: string;
  entityGlobalId: string;
  localEntityId: number | null;
  changeType: SyncChangeType;
  payload: unknown;
  originNodeId: string;
  originSequence: number;
  causedByChangeId: string | null;
  parentRevision: string | null;
  createdAt: Date;
}): SyncChange {
  return {
    changeId: row.changeId,
    operationId: row.operationId,
    entityType: row.entityType,
    entityGlobalId: row.entityGlobalId,
    localEntityId: row.localEntityId,
    changeType: row.changeType,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    originNodeId: row.originNodeId,
    originSequence: row.originSequence,
    causedByChangeId: row.causedByChangeId,
    parentRevision: row.parentRevision,
    createdAt: row.createdAt.toISOString(),
  };
}

export function computeSyncPackageHash(input: {
  sessionId: string;
  direction: SyncPackageDirection;
  baseVector: SyncVector;
  lastVector: SyncVector;
  changes: SyncChange[];
}) {
  return createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
}

const packageHash = computeSyncPackageHash;

async function getSessionOrThrow(sessionId: string) {
  const [session] = await db
    .select()
    .from(syncSessionTable)
    .where(eq(syncSessionTable.sessionId, sessionId))
    .limit(1);
  if (!session) throw new Error("SYNC_SESSION_NOT_FOUND");
  if (session.expiresAt && session.expiresAt.getTime() <= Date.now()) {
    throw new Error("SYNC_SESSION_EXPIRED");
  }
  return session;
}

export async function currentVector(): Promise<SyncVector> {
  const [identity] = await db
    .select({ nodeId: nodeIdentityTable.nodeId, originSequence: nodeIdentityTable.originSequence })
    .from(nodeIdentityTable)
    .limit(1);
  const rows = await db
    .select({
      originNodeId: syncChangeLogTable.originNodeId,
      originSequence: syncChangeLogTable.originSequence,
    })
    .from(syncChangeLogTable)
    .where(sql`${syncChangeLogTable.status} NOT IN ('rejected')`);
  const vector: SyncVector = {};
  for (const row of rows) {
    vector[row.originNodeId] = Math.max(vector[row.originNodeId] ?? 0, row.originSequence);
  }
  if (identity) vector[identity.nodeId] = Math.max(vector[identity.nodeId] ?? 0, identity.originSequence);
  return vector;
}

function directionFor(session: {
  sourceNodeId: string;
  targetNodeId: string;
}, nodeId: string): SyncPackageDirection {
  if (nodeId === session.sourceNodeId) return "source-to-target";
  if (nodeId === session.targetNodeId) return "target-to-source";
  throw new Error("SYNC_NODE_NOT_PART_OF_SESSION");
}

function packageNodes(session: {
  sourceNodeId: string;
  targetNodeId: string;
}, direction: SyncPackageDirection) {
  return direction === "source-to-target"
    ? { sourceNodeId: session.sourceNodeId, targetNodeId: session.targetNodeId }
    : { sourceNodeId: session.targetNodeId, targetNodeId: session.sourceNodeId };
}

export async function getSyncNode() {
  const identity = await ensureNodeIdentity("web");
  return { ...identity, vector: await currentVector() };
}

export async function createSyncSession(input: {
  sessionId?: string;
  sourceNodeId?: string;
  targetNodeId: string;
  expiresInMs?: number;
}) {
  const identity = await ensureNodeIdentity("web");
  const sourceNodeId = input.sourceNodeId ?? identity.nodeId;
  if (sourceNodeId !== identity.nodeId && input.targetNodeId !== identity.nodeId) {
    throw new Error("SYNC_LOCAL_NODE_REQUIRED");
  }
  if (!input.targetNodeId || input.targetNodeId === sourceNodeId) {
    throw new Error("SYNC_TARGET_NODE_REQUIRED");
  }
  const sessionId = input.sessionId ?? randomUUID();
  const vector = await currentVector();
  const expiresAt = new Date(Date.now() + (input.expiresInMs ?? 24 * 60 * 60 * 1000));
  await db
    .insert(syncSessionTable)
    .values({
      sessionId,
      sourceNodeId,
      targetNodeId: input.targetNodeId,
      sourceVector: vector,
      targetVector: {},
      sourceLastVector: vector,
      targetLastVector: {},
      expiresAt,
    })
    .onConflictDoNothing();
  return getSyncSession(sessionId);
}

export async function getSyncSession(sessionId: string) {
  const session = await getSessionOrThrow(sessionId);
  const packages = await db
    .select({
      packageId: syncSessionPackageTable.packageId,
      direction: syncSessionPackageTable.direction,
      status: syncSessionPackageTable.status,
      contentHash: syncSessionPackageTable.contentHash,
      baseVector: syncSessionPackageTable.baseVector,
      lastVector: syncSessionPackageTable.lastVector,
      report: syncSessionPackageTable.report,
      createdAt: syncSessionPackageTable.createdAt,
      updatedAt: syncSessionPackageTable.updatedAt,
      acknowledgedAt: syncSessionPackageTable.acknowledgedAt,
    })
    .from(syncSessionPackageTable)
    .where(eq(syncSessionPackageTable.sessionId, sessionId))
    .orderBy(asc(syncSessionPackageTable.createdAt));
  return { ...session, packages };
}

export async function handshakeSyncSession(
  sessionId: string,
  nodeId: string,
  peerVectorInput: unknown,
) {
  const session = await getSessionOrThrow(sessionId);
  const direction = directionFor(session, nodeId);
  const peerVector = asVector(peerVectorInput);
  const localVector = await currentVector();
  const update =
    direction === "source-to-target"
      ? { sourceVector: localVector, targetVector: peerVector, status: "handshake" as SyncSessionStatus }
      : { targetVector: localVector, sourceVector: peerVector, status: "handshake" as SyncSessionStatus };
  await db
    .update(syncSessionTable)
    .set({ ...update, updatedAt: new Date(), lastError: null })
    .where(eq(syncSessionTable.sessionId, sessionId));
  const packageInfo = await prepareSyncPackage(sessionId, nodeId, peerVector);
  return {
    sessionId,
    localNodeId: nodeId,
    peerNodeId: nodeId === session.sourceNodeId ? session.targetNodeId : session.sourceNodeId,
    localVector,
    peerVector,
    outgoing: packageInfo,
  };
}

export async function prepareSyncPackage(
  sessionId: string,
  nodeId: string,
  baseVectorInput: unknown,
) {
  const session = await getSessionOrThrow(sessionId);
  const direction = directionFor(session, nodeId);
  const baseVector = asVector(baseVectorInput);
  const rows = await db
    .select()
    .from(syncChangeLogTable)
    .orderBy(asc(syncChangeLogTable.originNodeId), asc(syncChangeLogTable.originSequence));
  const changes = rows
    .filter(
      (row) =>
        row.status !== "rejected" &&
        row.originSequence > (baseVector[row.originNodeId] ?? 0),
    )
    .map(changeToContract);
  const lastVector = mergeVector(baseVector, await currentVector());
  const contentHash = packageHash({ sessionId, direction, baseVector, lastVector, changes });
  const existing = await db
    .select()
    .from(syncSessionPackageTable)
    .where(
      and(
        eq(syncSessionPackageTable.sessionId, sessionId),
        eq(syncSessionPackageTable.contentHash, contentHash),
      ),
    )
    .limit(1);
  if (existing[0]) return existing[0];

  const packageId = randomUUID();
  const nodes = packageNodes(session, direction);
  await db.insert(syncSessionPackageTable).values({
    packageId,
    sessionId,
    direction,
    sourceNodeId: nodes.sourceNodeId,
    targetNodeId: nodes.targetNodeId,
    baseVector,
    lastVector,
    changes,
    contentHash,
    status: "prepared",
  });
  if (changes.length) {
    await db
      .update(syncOutboxTable)
      .set({ status: "exported", exportedAt: new Date() })
      .where(inArray(syncOutboxTable.changeId, changes.map((change) => change.changeId)));
  }
  await db
    .update(syncSessionTable)
    .set({
      status: "prepared",
      ...(direction === "source-to-target"
        ? { sourceLastVector: lastVector }
        : { targetLastVector: lastVector }),
      updatedAt: new Date(),
    })
    .where(eq(syncSessionTable.sessionId, sessionId));
  const [created] = await db
    .select()
    .from(syncSessionPackageTable)
    .where(eq(syncSessionPackageTable.packageId, packageId));
  return created;
}

function packageChanges(value: unknown): SyncChange[] {
  if (!Array.isArray(value)) throw new Error("SYNC_PACKAGE_CHANGES_INVALID");
  return value as SyncChange[];
}

export function classifyConflictSeverity(
  conflictCode: string,
): "low" | "medium" | "high" | "critical" {
  return classifySeverity(conflictCode);
}

export async function applySyncPackage(input: {
  sessionId: string;
  nodeId: string;
  packageId: string;
  direction: SyncPackageDirection;
  baseVector: unknown;
  lastVector: unknown;
  contentHash: string;
  changes: unknown;
}): Promise<SyncPackageReport> {
  const session = await getSessionOrThrow(input.sessionId);
  const expected = directionFor(session, input.nodeId) === "source-to-target"
    ? "target-to-source"
    : "source-to-target";
  if (input.direction !== expected) throw new Error("SYNC_PACKAGE_DIRECTION_INVALID");
  const nodes = packageNodes(session, input.direction);
  if (nodes.targetNodeId !== input.nodeId) throw new Error("SYNC_PACKAGE_TARGET_INVALID");
  const baseVector = asVector(input.baseVector);
  const lastVector = asVector(input.lastVector);
  const changes = packageChanges(input.changes);
  const expectedHash = packageHash({
    sessionId: input.sessionId,
    direction: input.direction,
    baseVector,
    lastVector,
    changes,
  });
  if (expectedHash !== input.contentHash) throw new Error("SYNC_PACKAGE_HASH_INVALID");

  const existingPackage = await db
    .select()
    .from(syncSessionPackageTable)
    .where(eq(syncSessionPackageTable.packageId, input.packageId))
    .limit(1);
  if (existingPackage[0]?.report) return existingPackage[0].report as SyncPackageReport;

  const report = await db.transaction(async (tx) => {
    const existingRows = await tx.select().from(syncChangeLogTable);
    const existingByOperation = new Map(existingRows.map((row) => [row.operationId, row]));
    const currentByOrigin = new Map<string, number>();
    for (const row of existingRows) {
      currentByOrigin.set(
        row.originNodeId,
        Math.max(currentByOrigin.get(row.originNodeId) ?? 0, row.originSequence),
      );
    }

    const newChanges: SyncChange[] = [];
    let duplicate = 0;
    let conflicts = 0;
    for (const change of changes) {
      if (
        !change?.changeId ||
        !change.operationId ||
        !change.originNodeId ||
        !Number.isSafeInteger(change.originSequence) ||
        change.originSequence < 1
      ) {
        throw new Error("SYNC_CHANGE_INVALID");
      }
      const existing = existingByOperation.get(change.operationId);
      if (existing) {
        if (
          existing.entityGlobalId !== change.entityGlobalId ||
          JSON.stringify(existing.payload) !== JSON.stringify(change.payload)
        ) {
          conflicts++;
          await tx
            .update(syncChangeLogTable)
            .set({ status: "conflict" as SyncChangeStatus, rejectionCode: "OPERATION_PAYLOAD_MISMATCH" })
            .where(eq(syncChangeLogTable.changeId, existing.changeId));
          await tx
            .insert(syncConflictTable)
            .values({
              changeId: existing.changeId,
              conflictCode: "OPERATION_PAYLOAD_MISMATCH",
              severity: classifyConflictSeverity("OPERATION_PAYLOAD_MISMATCH"),
              details: { incomingChangeId: change.changeId, operationId: change.operationId },
            })
            .onConflictDoNothing();
        } else {
          duplicate++;
          await tx
            .insert(syncInboxTable)
            .values({ changeId: change.changeId, originNodeId: change.originNodeId, status: "duplicate" })
            .onConflictDoNothing();
        }
        continue;
      }
      newChanges.push(change);
    }

    const grouped = new Map<string, SyncChange[]>();
    for (const change of newChanges) {
      const group = grouped.get(change.originNodeId) ?? [];
      group.push(change);
      grouped.set(change.originNodeId, group);
    }
    for (const [originNodeId, group] of grouped) {
      group.sort((a, b) => a.originSequence - b.originSequence);
      let expectedSequence = (currentByOrigin.get(originNodeId) ?? 0) + 1;
      for (const change of group) {
        if (change.originSequence !== expectedSequence) {
          throw new Error(`SYNC_SEQUENCE_GAP:${originNodeId}:${expectedSequence}`);
        }
        expectedSequence++;
      }
    }

    for (const change of newChanges) {
      await tx.insert(syncChangeLogTable).values({
        changeId: change.changeId,
        operationId: change.operationId,
        entityType: change.entityType,
        entityGlobalId: change.entityGlobalId,
        localEntityId: change.localEntityId ?? null,
        changeType: change.changeType,
        payload: change.payload,
        originNodeId: change.originNodeId,
        originSequence: change.originSequence,
        causedByChangeId: change.causedByChangeId ?? null,
        parentRevision: change.parentRevision ?? null,
        createdAt: change.createdAt ? new Date(change.createdAt) : new Date(),
        receivedAt: new Date(),
        appliedAt: new Date(),
        status: "applied",
      });
      await tx
        .insert(syncInboxTable)
        .values({
          changeId: change.changeId,
          originNodeId: change.originNodeId,
          status: "applied",
          appliedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: syncInboxTable.changeId,
          set: { status: "applied", appliedAt: new Date(), rejectionCode: null },
        });
      if (change.changeType === "delete") {
        await tx
          .insert(syncTombstoneTable)
          .values({
            entityType: change.entityType,
            entityGlobalId: change.entityGlobalId,
            deletedByChangeId: change.changeId,
            originNodeId: change.originNodeId,
          })
          .onConflictDoNothing();
      }
      currentByOrigin.set(
        change.originNodeId,
        Math.max(currentByOrigin.get(change.originNodeId) ?? 0, change.originSequence),
      );
    }

    // ── Business-state materialization (approved 27-08-2026) ──────────────
    // The engine previously stopped at the change log. Incoming payloads are
    // now applied to the local business tables; failures are recorded as
    // conflicts and surfaced in the UI for an explicit decision.
    const materialized = await materializeChanges(tx, newChanges);
    if (materialized.conflicts.length > 0) {
      const conflictChangeIds = new Set(
        materialized.conflicts.map((conflict) => conflict.changeId),
      );
      for (const changeId of conflictChangeIds) {
        await tx
          .update(syncChangeLogTable)
          .set({ status: "conflict", appliedAt: new Date() })
          .where(eq(syncChangeLogTable.changeId, changeId));
      }
    }

    const nextVector = mergeVector(
      Object.fromEntries(currentByOrigin.entries()),
      lastVector,
    );
    await tx
      .insert(syncCursorTable)
      .values({ peerNodeId: nodes.sourceNodeId, vector: nextVector })
      .onConflictDoUpdate({
        target: syncCursorTable.peerNodeId,
        set: { vector: nextVector, updatedAt: new Date() },
      });
    const counts = {
      received: changes.length,
      applied: materialized.applied,
      duplicate,
      conflicts: materialized.conflicts.length,
      rejected: 0,
    };
    const result: SyncPackageReport = {
      packageId: input.packageId,
      contentHash: input.contentHash,
      counts,
      baseVector,
      lastVector: nextVector,
      status: conflicts > 0 || materialized.conflicts.length > 0 ? "partially-applied" : "applied",
    };
    await tx
      .insert(syncSessionPackageTable)
      .values({
        packageId: input.packageId,
        sessionId: input.sessionId,
        direction: input.direction,
        sourceNodeId: nodes.sourceNodeId,
        targetNodeId: nodes.targetNodeId,
        baseVector,
        lastVector,
        changes,
        contentHash: input.contentHash,
        status: conflicts > 0 || materialized.conflicts.length > 0 ? "failed" : "applied",
        report: result,
      })
      .onConflictDoUpdate({
        target: syncSessionPackageTable.packageId,
        set: {
          status: conflicts > 0 || materialized.conflicts.length > 0 ? "failed" : "applied",
          report: result,
          updatedAt: new Date(),
        },
      });
    await tx
      .update(syncSessionTable)
      .set({
        status: conflicts > 0 || materialized.conflicts.length > 0 ? "partially-applied" : "transferring",
        targetVector: nextVector,
        targetLastVector: nextVector,
        updatedAt: new Date(),
        lastError:
          conflicts > 0 || materialized.conflicts.length > 0
            ? materialized.conflicts[0]?.code ?? "OPERATION_PAYLOAD_MISMATCH"
            : null,
      })
      .where(eq(syncSessionTable.sessionId, input.sessionId));
    return result;
  });
  return report;
}

export async function acknowledgeSyncPackage(
  sessionId: string,
  packageId: string,
  nodeId: string,
) {
  const session = await getSessionOrThrow(sessionId);
  const [pkg] = await db
    .select()
    .from(syncSessionPackageTable)
    .where(
      and(
        eq(syncSessionPackageTable.packageId, packageId),
        eq(syncSessionPackageTable.sessionId, sessionId),
      ),
    )
    .limit(1);
  if (!pkg) throw new Error("SYNC_PACKAGE_NOT_FOUND");
  if (pkg.targetNodeId !== nodeId) throw new Error("SYNC_ACK_NODE_INVALID");
  const changeIds = packageChanges(pkg.changes).map((change) => change.changeId);
  if (changeIds.length) {
    await db
      .update(syncOutboxTable)
      .set({ status: "acknowledged", acknowledgedAt: new Date() })
      .where(inArray(syncOutboxTable.changeId, changeIds));
  }
  await db
    .update(syncSessionPackageTable)
    .set({ status: "acknowledged", acknowledgedAt: new Date(), updatedAt: new Date() })
    .where(eq(syncSessionPackageTable.packageId, packageId));
  const packages = await db
    .select({ status: syncSessionPackageTable.status })
    .from(syncSessionPackageTable)
    .where(eq(syncSessionPackageTable.sessionId, sessionId));
  const complete =
    packages.length >= 2 &&
    packages.every((item) => item.status === "acknowledged" || item.status === "applied");
  if (complete) {
    await db
      .update(syncSessionTable)
      .set({ status: "completed", updatedAt: new Date(), lastError: null })
      .where(eq(syncSessionTable.sessionId, sessionId));
  }
  return getSyncSession(sessionId);
}

export async function getSyncPackage(packageId: string) {
  const [pkg] = await db
    .select()
    .from(syncSessionPackageTable)
    .where(eq(syncSessionPackageTable.packageId, packageId))
    .limit(1);
  if (!pkg) throw new Error("SYNC_PACKAGE_NOT_FOUND");
  return pkg;
}

/* ── Session-independent exchange primitives (approved 27-08-2026) ──────── */

/**
 * Changes this node should send to a peer whose knowledge is described by
 * `peerVector` — every non-rejected change beyond the peer's vector, ordered
 * by (originNodeId, originSequence) for deterministic application.
 */
export async function prepareOutgoingChanges(
  peerVector: SyncVector,
): Promise<SyncChange[]> {
  const rows = await db
    .select()
    .from(syncChangeLogTable)
    .orderBy(asc(syncChangeLogTable.originNodeId), asc(syncChangeLogTable.originSequence));
  return rows
    .filter(
      (row) =>
        row.status !== "rejected" &&
        row.originSequence > (peerVector[row.originNodeId] ?? 0),
    )
    .map(changeToContract);
}

/**
 * Apply a peer's changes with the same guarantees as a session package
 * (operation-id dedup, sequence validation, recording, materialization,
 * cursor update) without requiring a sync session. Returns a report.
 */
/** Canonical JSON: recursively sorted keys, so payload equality is robust
 *  regardless of jsonb re-encoding or canonicalJson key sorting in the
 *  package format. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  const parts = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${parts.join(",")}}`;
}

export async function applyIncomingChanges(input: {
  changes: unknown;
  baseVector: unknown;
  lastVector: unknown;
  sourceNodeId: string;
  contextUserId?: number | null;
}): Promise<SyncPackageReport> {
  const changes = packageChanges(input.changes);
  const baseVector = asVector(input.baseVector);
  const lastVector = asVector(input.lastVector);

  const report = await db.transaction(async (tx) => {
    const existingRows = await tx.select().from(syncChangeLogTable);
    const existingByOperation = new Map(existingRows.map((row) => [row.operationId, row]));
    const existingByChangeId = new Map(existingRows.map((row) => [row.changeId, row]));
    const currentByOrigin = new Map<string, number>();
    for (const row of existingRows) {
      currentByOrigin.set(
        row.originNodeId,
        Math.max(currentByOrigin.get(row.originNodeId) ?? 0, row.originSequence),
      );
    }

    const newChanges: SyncChange[] = [];
    let duplicate = 0;
    let payloadConflicts = 0;
    let rejected = 0;
    for (const change of changes) {
      if (
        !change?.changeId ||
        !change.operationId ||
        !change.originNodeId ||
        !Number.isSafeInteger(change.originSequence) ||
        change.originSequence < 1
      ) {
        throw new Error("SYNC_CHANGE_INVALID");
      }
      // A change rejected on its origin node must never be applied.
      if (change.status === "rejected") {
        rejected++;
        continue;
      }
      const existing = existingByOperation.get(change.operationId) ?? existingByChangeId.get(change.changeId);
      if (existing) {
        if (
          existing.entityGlobalId !== change.entityGlobalId ||
          stableStringify(existing.payload ?? {}) !== stableStringify(change.payload ?? {})
        ) {
          payloadConflicts++;
          await tx
            .update(syncChangeLogTable)
            .set({ status: "conflict" as SyncChangeStatus, rejectionCode: "OPERATION_PAYLOAD_MISMATCH" })
            .where(eq(syncChangeLogTable.changeId, existing.changeId));
          await tx
            .insert(syncConflictTable)
            .values({
              changeId: existing.changeId,
              conflictCode: "OPERATION_PAYLOAD_MISMATCH",
              severity: classifySeverity("OPERATION_PAYLOAD_MISMATCH"),
              details: { incomingChangeId: change.changeId, operationId: change.operationId },
            })
            .onConflictDoNothing();
        } else {
          duplicate++;
          await tx
            .insert(syncInboxTable)
            .values({ changeId: change.changeId, originNodeId: change.originNodeId, status: "duplicate" })
            .onConflictDoNothing();
        }
        continue;
      }
      newChanges.push(change);
    }

    const grouped = new Map<string, SyncChange[]>();
    for (const change of newChanges) {
      const group = grouped.get(change.originNodeId) ?? [];
      group.push(change);
      grouped.set(change.originNodeId, group);
    }
    for (const [originNodeId, group] of grouped) {
      group.sort((a, b) => a.originSequence - b.originSequence);
      let expectedSequence = (currentByOrigin.get(originNodeId) ?? 0) + 1;
      for (const change of group) {
        if (change.originSequence !== expectedSequence) {
          throw new Error(`SYNC_SEQUENCE_GAP:${originNodeId}:${expectedSequence}`);
        }
        expectedSequence++;
      }
    }

    for (const change of newChanges) {
      await tx.insert(syncChangeLogTable).values({
        changeId: change.changeId,
        operationId: change.operationId,
        entityType: change.entityType,
        entityGlobalId: change.entityGlobalId,
        localEntityId: change.localEntityId ?? null,
        changeType: change.changeType,
        payload: change.payload,
        originNodeId: change.originNodeId,
        originSequence: change.originSequence,
        causedByChangeId: change.causedByChangeId ?? null,
        parentRevision: change.parentRevision ?? null,
        createdAt: change.createdAt ? new Date(change.createdAt) : new Date(),
        receivedAt: new Date(),
        appliedAt: new Date(),
        status: "applied",
      });
      await tx
        .insert(syncInboxTable)
        .values({
          changeId: change.changeId,
          originNodeId: change.originNodeId,
          status: "applied",
          appliedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: syncInboxTable.changeId,
          set: { status: "applied", appliedAt: new Date(), rejectionCode: null },
        });
      if (change.changeType === "delete") {
        await tx
          .insert(syncTombstoneTable)
          .values({
            entityType: change.entityType,
            entityGlobalId: change.entityGlobalId,
            deletedByChangeId: change.changeId,
            originNodeId: change.originNodeId,
          })
          .onConflictDoNothing();
      }
      currentByOrigin.set(
        change.originNodeId,
        Math.max(currentByOrigin.get(change.originNodeId) ?? 0, change.originSequence),
      );
    }

    const materialized = await materializeChanges(tx, newChanges, input.contextUserId ?? null);
    if (materialized.conflicts.length > 0) {
      for (const conflict of materialized.conflicts) {
        await tx
          .update(syncChangeLogTable)
          .set({ status: "conflict", appliedAt: new Date() })
          .where(eq(syncChangeLogTable.changeId, conflict.changeId));
      }
    }

    const nextVector = mergeVector(
      Object.fromEntries(currentByOrigin.entries()),
      lastVector,
    );
    await tx
      .insert(syncCursorTable)
      .values({ peerNodeId: input.sourceNodeId, vector: nextVector })
      .onConflictDoUpdate({
        target: syncCursorTable.peerNodeId,
        set: { vector: nextVector, updatedAt: new Date() },
      });
    const counts = {
      received: changes.length,
      applied: materialized.applied,
      duplicate,
      conflicts: materialized.conflicts.length + payloadConflicts,
      rejected,
    };
    return {
      packageId: `exchange-${randomUUID()}`,
      contentHash: "",
      counts,
      baseVector,
      lastVector: nextVector,
      status: (
        materialized.conflicts.length > 0 || payloadConflicts > 0
          ? "partially-applied"
          : "applied"
      ) as SyncPackageReport["status"],
    };
  });
  return report;
}