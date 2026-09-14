import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull, lt, or } from "drizzle-orm";
import {
  db,
  syncPairingTable,
  syncRelayPackageTable,
  syncTrustedNodeTable,
  type SyncNodeType,
  type SyncPackageDirection,
} from "@workspace/db";
import { getSyncNode, getSyncSession } from "./sync-service";

const DEFAULT_PAIRING_TTL_MS = 10 * 60 * 1000;
const DEFAULT_RELAY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RELAY_BYTES = 64 * 1024 * 1024;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function hash(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function makePairingCode() {
  const bytes = randomBytes(8);
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

function asDate(value: unknown, fallbackMs: number) {
  const date = value ? new Date(String(value)) : new Date(Date.now() + fallbackMs);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) {
    throw new Error("SYNC_EXPIRY_INVALID");
  }
  return date;
}

async function assertSessionDirection(
  sessionId: string,
  sourceNodeId: string,
  targetNodeId: string,
  direction: SyncPackageDirection,
) {
  const session = await getSyncSession(sessionId);
  if (
    session.sourceNodeId !== sourceNodeId ||
    session.targetNodeId !== targetNodeId ||
    !["source-to-target", "target-to-source"].includes(direction)
  ) {
    throw new Error("SYNC_RELAY_TARGET_INVALID");
  }
  if (session.expiresAt && new Date(session.expiresAt).getTime() <= Date.now()) {
    throw new Error("SYNC_SESSION_EXPIRED");
  }
  return session;
}

export async function createPairing(input: {
  targetNodeId?: string | null;
  ttlMs?: number;
}) {
  const source = await getSyncNode();
  const code = makePairingCode();
  const expiresAt = new Date(Date.now() + Math.min(input.ttlMs ?? DEFAULT_PAIRING_TTL_MS, 60 * 60 * 1000));
  await db.insert(syncPairingTable).values({
    pairingId: randomUUID(),
    codeHash: hash(code),
    sourceNodeId: source.nodeId,
    targetNodeId: input.targetNodeId || null,
    expiresAt,
  });
  return { code, sourceNodeId: source.nodeId, expiresAt };
}

export async function consumePairing(input: {
  code: string;
  nodeId: string;
  nodeType: SyncNodeType;
  label?: string | null;
}) {
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z2-9]{8}$/.test(code)) throw new Error("SYNC_PAIRING_INVALID");
  await db.transaction(async (tx) => {
    // Claim the pairing row atomically so two concurrent consumers cannot both
    // pass a read-then-write check and create two trusted-node records.
    const [pairing] = await tx
      .update(syncPairingTable)
      .set({ consumedAt: new Date(), targetNodeId: input.nodeId })
      .where(
        and(
          eq(syncPairingTable.codeHash, hash(code)),
          isNull(syncPairingTable.consumedAt),
          isNull(syncPairingTable.revokedAt),
          gt(syncPairingTable.expiresAt, new Date()),
          or(isNull(syncPairingTable.targetNodeId), eq(syncPairingTable.targetNodeId, input.nodeId)),
        ),
      )
      .returning();
    if (!pairing) throw new Error("SYNC_PAIRING_EXPIRED_OR_USED");
    await tx
      .insert(syncTrustedNodeTable)
      .values({
        nodeId: input.nodeId,
        nodeType: input.nodeType,
        label: input.label || null,
        status: "trusted",
        lastSeenAt: new Date(),
      })
      .onConflictDoUpdate({
        target: syncTrustedNodeTable.nodeId,
        set: { nodeType: input.nodeType, label: input.label || null, status: "trusted", lastSeenAt: new Date(), revokedAt: null },
      });
  });
  return { nodeId: input.nodeId, status: "trusted" as const, pairedAt: new Date() };
}

export async function listTrustedNodes() {
  return db.select().from(syncTrustedNodeTable).orderBy(desc(syncTrustedNodeTable.pairedAt));
}

export async function revokeTrustedNode(nodeId: string) {
  const [updated] = await db
    .update(syncTrustedNodeTable)
    .set({ status: "revoked", revokedAt: new Date() })
    .where(eq(syncTrustedNodeTable.nodeId, nodeId))
    .returning();
  if (!updated) throw new Error("SYNC_TRUSTED_NODE_NOT_FOUND");
  return updated;
}

export async function uploadRelayPackage(input: {
  sessionId: string;
  packageId: string;
  responseToRelayId?: string | null;
  direction: SyncPackageDirection;
  sourceNodeId: string;
  targetNodeId: string;
  contentHash: string;
  payloadBase64: string;
  expiresAt?: string;
}) {
  await assertSessionDirection(input.sessionId, input.sourceNodeId, input.targetNodeId, input.direction);
  const payload = Buffer.from(input.payloadBase64, "base64");
  if (!payload.length || payload.length > MAX_RELAY_BYTES) throw new Error("SYNC_RELAY_PAYLOAD_TOO_LARGE");
  const transportHash = hash(payload);
  const expiresAt = asDate(input.expiresAt, DEFAULT_RELAY_TTL_MS);
  const [existing] = await db
    .select()
    .from(syncRelayPackageTable)
    .where(and(eq(syncRelayPackageTable.sessionId, input.sessionId), eq(syncRelayPackageTable.transportHash, transportHash)))
    .limit(1);
  if (existing) return relayMetadata(existing);
  const [created] = await db
    .insert(syncRelayPackageTable)
    .values({
      relayId: randomUUID(),
      sessionId: input.sessionId,
      packageId: input.packageId,
      responseToRelayId: input.responseToRelayId || null,
      direction: input.direction,
      sourceNodeId: input.sourceNodeId,
      targetNodeId: input.targetNodeId,
      contentHash: input.contentHash,
      transportHash,
      payload: input.payloadBase64,
      expiresAt,
    })
    .returning();
  if (!created) throw new Error("SYNC_RELAY_UPLOAD_FAILED");
  return relayMetadata(created);
}

function relayMetadata(row: typeof syncRelayPackageTable.$inferSelect) {
  return {
    relayId: row.relayId,
    sessionId: row.sessionId,
    packageId: row.packageId,
    responseToRelayId: row.responseToRelayId,
    direction: row.direction,
    sourceNodeId: row.sourceNodeId,
    targetNodeId: row.targetNodeId,
    contentHash: row.contentHash,
    transportHash: row.transportHash,
    status: row.expiresAt.getTime() <= Date.now() ? "expired" : row.status,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

export async function getRelayPackage(relayId: string, includePayload = false) {
  const [row] = await db.select().from(syncRelayPackageTable).where(eq(syncRelayPackageTable.relayId, relayId)).limit(1);
  if (!row) throw new Error("SYNC_RELAY_NOT_FOUND");
  if (row.expiresAt.getTime() <= Date.now()) {
    await db.update(syncRelayPackageTable).set({ status: "expired" }).where(eq(syncRelayPackageTable.relayId, relayId));
    throw new Error("SYNC_RELAY_EXPIRED");
  }
  if (includePayload) {
    await db.update(syncRelayPackageTable).set({ status: "downloaded", downloadedAt: new Date() }).where(eq(syncRelayPackageTable.relayId, relayId));
    return { ...relayMetadata(row), payloadBase64: row.payload };
  }
  return relayMetadata(row);
}

export async function listRelayPackages(sessionId?: string) {
  const conditions = [gt(syncRelayPackageTable.expiresAt, new Date())];
  if (sessionId) conditions.push(eq(syncRelayPackageTable.sessionId, sessionId));
  return (await db.select().from(syncRelayPackageTable).where(and(...conditions)).orderBy(desc(syncRelayPackageTable.createdAt))).map(relayMetadata);
}

export async function purgeExpiredRelayPackages() {
  return db
    .delete(syncRelayPackageTable)
    .where(lt(syncRelayPackageTable.expiresAt, new Date()))
    .returning({ relayId: syncRelayPackageTable.relayId });
}