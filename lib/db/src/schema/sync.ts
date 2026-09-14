import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

export type SyncNodeType = "windows" | "android" | "web";
export type SyncChangeType =
  | "create"
  | "update"
  | "delete"
  | "correction"
  | "system-reconciliation";
export type SyncChangeStatus =
  | "local-pending"
  | "exported"
  | "received"
  | "validated"
  | "applied"
  | "duplicate"
  | "rejected"
  | "conflict"
  | "superseded";

export type SyncSessionStatus =
  | "created"
  | "handshake"
  | "prepared"
  | "transferring"
  | "partially-applied"
  | "completed"
  | "failed"
  | "cancelled";

export type SyncPackageDirection = "source-to-target" | "target-to-source";
export type SyncPackageStatus =
  | "prepared"
  | "received"
  | "applied"
  | "acknowledged"
  | "failed";
export type RelayPackageStatus = "available" | "downloaded" | "expired" | "deleted";
export type ConflictSeverity = "low" | "medium" | "high" | "critical";

/**
 * One durable identity per installation/database. The sequence is reserved
 * inside the same transaction that records a local change.
 */
export const nodeIdentityTable = pgTable("node_identity", {
  id: serial("id").primaryKey(),
  nodeId: text("node_id").notNull().unique(),
  installationId: text("installation_id").notNull().unique(),
  nodeType: text("node_type").notNull().$type<SyncNodeType>(),
  keyId: text("key_id"),
  // Ed25519 signing keypair for non-repudiation. The private key never leaves
  // this node; only the public key is shared with trusted peers.
  signingPublicKey: text("signing_public_key"),
  signingPrivateKey: text("signing_private_key"),
  originSequence: integer("origin_sequence").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Compatibility map for legacy integer primary keys. Keeping this separate
 * lets PostgreSQL, PGlite, and IndexedDB use the same canonical identity
 * without rewriting every existing business table in the first migration.
 */
export const syncEntityIdsTable = pgTable(
  "sync_entity_ids",
  {
    id: serial("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    localId: integer("local_id").notNull(),
    globalId: text("global_id").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("sync_entity_ids_entity_local_unique").on(table.entityType, table.localId),
    index("sync_entity_ids_entity_type_idx").on(table.entityType),
  ],
);

export const syncChangeLogTable = pgTable(
  "sync_change_log",
  {
    changeId: text("change_id").primaryKey(),
    operationId: text("operation_id").notNull().unique(),
    entityType: text("entity_type").notNull(),
    entityGlobalId: text("entity_global_id").notNull(),
    localEntityId: integer("local_entity_id"),
    changeType: text("change_type").notNull().$type<SyncChangeType>(),
    payload: jsonb("payload").notNull(),
    originNodeId: text("origin_node_id").notNull(),
    originSequence: integer("origin_sequence").notNull(),
    causedByChangeId: text("caused_by_change_id"),
    parentRevision: text("parent_revision"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    status: text("status").notNull().$type<SyncChangeStatus>().default("local-pending"),
    rejectionCode: text("rejection_code"),
  },
  (table) => [
    index("sync_change_log_origin_sequence_idx").on(table.originNodeId, table.originSequence),
    index("sync_change_log_entity_idx").on(table.entityType, table.entityGlobalId),
    index("sync_change_log_status_idx").on(table.status),
  ],
);

export const syncOutboxTable = pgTable(
  "sync_outbox",
  {
    id: serial("id").primaryKey(),
    changeId: text("change_id")
      .notNull()
      .references(() => syncChangeLogTable.changeId, { onDelete: "cascade" }),
    status: text("status").notNull().$type<"pending" | "exported" | "acknowledged">().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    exportedAt: timestamp("exported_at", { withTimezone: true }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  },
  (table) => [unique("sync_outbox_change_unique").on(table.changeId)],
);

export const syncInboxTable = pgTable(
  "sync_inbox",
  {
    id: serial("id").primaryKey(),
    changeId: text("change_id").notNull().unique(),
    originNodeId: text("origin_node_id").notNull(),
    status: text("status").notNull().$type<"received" | "validated" | "applied" | "duplicate" | "rejected" | "conflict">().default("received"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    rejectionCode: text("rejection_code"),
  },
  (table) => [index("sync_inbox_status_idx").on(table.status)],
);

export const syncCursorTable = pgTable("sync_cursors", {
  id: serial("id").primaryKey(),
  peerNodeId: text("peer_node_id").notNull().unique(),
  vector: jsonb("vector").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const syncConflictTable = pgTable(
  "sync_conflicts",
  {
    id: serial("id").primaryKey(),
    changeId: text("change_id").notNull().unique(),
    conflictCode: text("conflict_code").notNull(),
    severity: text("severity").notNull().$type<ConflictSeverity>().default("medium"),
    details: jsonb("details").notNull(),
    status: text("status").notNull().$type<"open" | "resolved" | "deferred">().default("open"),
    resolvedBy: integer("resolved_by"),
    resolution: text("resolution"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [index("sync_conflicts_status_idx").on(table.status)],
);

export const syncTombstoneTable = pgTable(
  "sync_tombstones",
  {
    id: serial("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    entityGlobalId: text("entity_global_id").notNull(),
    deletedByChangeId: text("deleted_by_change_id").notNull(),
    originNodeId: text("origin_node_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    propagated: boolean("propagated").notNull().default(false),
  },
  (table) => [
    unique("sync_tombstones_entity_unique").on(table.entityType, table.entityGlobalId),
    index("sync_tombstones_propagated_idx").on(table.propagated),
  ],
);

/**
 * Nodes explicitly trusted by an administrator. Pairing codes create these
 * rows; revocation is retained for auditability instead of deleting trust
 * history.
 */
export const syncTrustedNodeTable = pgTable(
  "sync_trusted_nodes",
  {
    nodeId: text("node_id").primaryKey(),
    nodeType: text("node_type").notNull().$type<SyncNodeType>(),
    label: text("label"),
    status: text("status").notNull().$type<"trusted" | "revoked">().default("trusted"),
    signingPublicKey: text("signing_public_key"),
    pairedAt: timestamp("paired_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  },
  (table) => [index("sync_trusted_nodes_status_idx").on(table.status)],
);

export const syncPairingTable = pgTable(
  "sync_pairings",
  {
    pairingId: text("pairing_id").primaryKey(),
    codeHash: text("code_hash").notNull().unique(),
    sourceNodeId: text("source_node_id").notNull(),
    targetNodeId: text("target_node_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("sync_pairings_expiry_idx").on(table.expiresAt),
    index("sync_pairings_source_idx").on(table.sourceNodeId),
  ],
);

/**
 * Relay stores the encrypted .dme-sync bytes as opaque bytea. The server
 * never decrypts or indexes the package contents. A response points to the
 * original relay item so a lost response can be recreated safely.
 */
export const syncRelayPackageTable = pgTable(
  "sync_relay_packages",
  {
    relayId: text("relay_id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => syncSessionTable.sessionId, { onDelete: "cascade" }),
    packageId: text("package_id").notNull(),
    responseToRelayId: text("response_to_relay_id"),
    direction: text("direction").notNull().$type<SyncPackageDirection>(),
    sourceNodeId: text("source_node_id").notNull(),
    targetNodeId: text("target_node_id").notNull(),
    contentHash: text("content_hash").notNull(),
    transportHash: text("transport_hash").notNull(),
    payload: text("payload").notNull(),
    status: text("status").notNull().$type<RelayPackageStatus>().default("available"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    downloadedAt: timestamp("downloaded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("sync_relay_session_transport_unique").on(table.sessionId, table.transportHash),
    index("sync_relay_packages_session_idx").on(table.sessionId),
    index("sync_relay_packages_expiry_idx").on(table.expiresAt),
    index("sync_relay_packages_status_idx").on(table.status),
  ],
);

/**
 * A durable two-node exchange. The vectors are snapshots, not mutable
 * guesses: every package records the exact base and resulting vector used to
 * build it so an interrupted session can be resumed safely.
 */
export const syncSessionTable = pgTable(
  "sync_sessions",
  {
    sessionId: text("session_id").primaryKey(),
    sourceNodeId: text("source_node_id").notNull(),
    targetNodeId: text("target_node_id").notNull(),
    status: text("status").notNull().$type<SyncSessionStatus>().default("created"),
    sourceVector: jsonb("source_vector").notNull().default({}),
    targetVector: jsonb("target_vector").notNull().default({}),
    sourceLastVector: jsonb("source_last_vector").notNull().default({}),
    targetLastVector: jsonb("target_last_vector").notNull().default({}),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [
    index("sync_sessions_source_idx").on(table.sourceNodeId),
    index("sync_sessions_target_idx").on(table.targetNodeId),
    index("sync_sessions_status_idx").on(table.status),
  ],
);

/**
 * Durable package metadata and payload. Phase 7 deliberately keeps the
 * package as JSONB; streaming/chunk storage belongs to the relay work in
 * phase 8.
 */
export const syncSessionPackageTable = pgTable(
  "sync_session_packages",
  {
    packageId: text("package_id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => syncSessionTable.sessionId, { onDelete: "cascade" }),
    direction: text("direction").notNull().$type<SyncPackageDirection>(),
    sourceNodeId: text("source_node_id").notNull(),
    targetNodeId: text("target_node_id").notNull(),
    baseVector: jsonb("base_vector").notNull().default({}),
    lastVector: jsonb("last_vector").notNull().default({}),
    changes: jsonb("changes").notNull().default([]),
    contentHash: text("content_hash").notNull(),
    status: text("status").notNull().$type<SyncPackageStatus>().default("prepared"),
    report: jsonb("report"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  },
  (table) => [
    unique("sync_session_packages_hash_unique").on(table.sessionId, table.contentHash),
    index("sync_session_packages_session_idx").on(table.sessionId),
    index("sync_session_packages_status_idx").on(table.status),
  ],
);