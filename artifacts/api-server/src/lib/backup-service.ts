import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import {
  createSyncPackage,
  packageSummary,
  readSyncPackage,
  SyncPackageError,
  type SyncPackage,
  type SyncRecord,
} from "@workspace/backup-format";
import { and, desc, eq, gt } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  backupCatalogTable,
  backupRetentionPolicyTable,
  backupRestorePreviewTable,
  backupRestorePointTable,
  nodeIdentityTable,
  usersTable,
} from "@workspace/db";

export { packageSummary };

const MAX_PACKAGE_BYTES = 48 * 1024 * 1024;
const SERVER_SCHEMA_VERSION = "2026.08";
const RESTORE_POINT_PASSWORD = process.env.SESSION_SECRET || "development-restore-point-key";

const TABLES = [
  "categories",
  "items",
  "equipment",
  "recipients",
  "exit_reasons",
  "system_settings",
  "transactions",
  "inventory_batches",
  "transaction_batch_allocations",
  "personal_custodies",
  "custody_returns",
  "damage_records",
  "central_returns",
  "audit_log",
] as const;
type BackupTable = (typeof TABLES)[number];

const TABLE_ENTITY_TYPES: Record<BackupTable, string> = Object.fromEntries(
  TABLES.map((table) => [table, table]),
) as Record<BackupTable, string>;

const TABLES_WITH_USERS = [...TABLES, "users"] as const;
const ENTITY_TO_TABLE: Record<string, BackupTable> = {
  category: "categories",
  categories: "categories",
  item: "items",
  items: "items",
  equipment: "equipment",
  equipments: "equipment",
  recipient: "recipients",
  recipients: "recipients",
  exit_reason: "exit_reasons",
  exit_reasons: "exit_reasons",
  setting: "system_settings",
  system_settings: "system_settings",
  transaction: "transactions",
  transactions: "transactions",
  inventory_batch: "inventory_batches",
  inventory_batches: "inventory_batches",
  transaction_batch_allocation: "transaction_batch_allocations",
  transaction_batch_allocations: "transaction_batch_allocations",
  personal_custody: "personal_custodies",
  personal_custodies: "personal_custodies",
  custody_return: "custody_returns",
  custody_returns: "custody_returns",
  damage_record: "damage_records",
  damage_records: "damage_records",
  central_return: "central_returns",
  central_returns: "central_returns",
  audit_log: "audit_log",
};
export type BackupVector = Record<string, number>;

type QueryExecutor = {
  execute(query: ReturnType<typeof sql>): Promise<unknown>;
};

function rowsFromResult(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  }
  return [];
}

async function queryRows(
  executor: QueryExecutor,
  table: string,
  orderBy = "id",
): Promise<Record<string, unknown>[]> {
  const result = await executor.execute(sql.raw(`SELECT * FROM "${table}" ORDER BY "${orderBy}"`));
  return rowsFromResult(result);
}

export async function collectBackupRecords(executor: QueryExecutor = db): Promise<SyncRecord[]> {
  const records: SyncRecord[] = [];
  for (const table of TABLES_WITH_USERS) {
    const rows =
      table === "users"
        ? rowsFromResult(
            await executor.execute(
              sql.raw(
                'SELECT "id", "username", "full_name", "role", "is_active", "created_at" FROM "users" ORDER BY "id"',
              ),
            ),
          )
        : await queryRows(executor, table);
    records.push(
      ...rows.map((data) => ({
        entityType: table,
        localId: typeof data.id === "number" ? data.id : null,
        data,
      })),
    );
  }
  return records;
}

async function collectChanges(executor: QueryExecutor = db) {
  const result = await executor.execute(
    sql.raw(
      `SELECT * FROM "sync_change_log" WHERE "status" != 'rejected' ORDER BY "origin_sequence"`,
    ),
  );
  const rows = rowsFromResult(result);
  return rows.map((row) => ({
    changeId: String(row.change_id),
    operationId: String(row.operation_id),
    entityType: String(row.entity_type),
    entityGlobalId: String(row.entity_global_id),
    localEntityId: row.local_entity_id == null ? null : Number(row.local_entity_id),
    changeType: String(row.change_type),
    payload: (row.payload ?? {}) as Record<string, unknown>,
    originNodeId: String(row.origin_node_id),
    originSequence: Number(row.origin_sequence),
    parentRevision: row.parent_revision == null ? null : String(row.parent_revision),
    status: row.status == null ? undefined : String(row.status),
    createdAt: row.created_at == null ? undefined : new Date(String(row.created_at)).toISOString(),
  }));
}

function vectorFromChanges(changes: Array<{ originNodeId: string; originSequence: number }>): BackupVector {
  return changes.reduce<BackupVector>((vector, change) => {
    vector[change.originNodeId] = Math.max(vector[change.originNodeId] ?? 0, change.originSequence);
    return vector;
  }, {});
}

async function collectCurrentRecordsForChanges(
  changes: Awaited<ReturnType<typeof collectChanges>>,
): Promise<SyncRecord[]> {
  const records: SyncRecord[] = [];
  const grouped = new Map<BackupTable, number[]>();
  for (const change of changes) {
    const table = ENTITY_TO_TABLE[change.entityType];
    if (!table || change.localEntityId == null) continue;
    const ids = grouped.get(table) ?? [];
    if (!ids.includes(change.localEntityId)) ids.push(change.localEntityId);
    grouped.set(table, ids);
  }

  for (const [table, ids] of grouped) {
    const safeIds = ids.filter((id) => Number.isInteger(id) && id > 0);
    if (!safeIds.length) continue;
    const rows = rowsFromResult(
      await db.execute(
        sql.raw(`SELECT * FROM "${table}" WHERE "id" IN (${safeIds.join(",")}) ORDER BY "id"`),
      ),
    );
    records.push(
      ...rows.map((data) => ({
        entityType: table,
        localId: typeof data.id === "number" ? data.id : null,
        data,
      })),
    );
  }
  return records;
}

export async function createFullBackup(password: string): Promise<Buffer> {
  const [identity] = await db
    .select({ nodeId: nodeIdentityTable.nodeId })
    .from(nodeIdentityTable)
    .limit(1);
  const records = await collectBackupRecords();
  const changes = await collectChanges();
  return createSyncPackage({
    password,
    packageType: "full-backup",
    schemaVersion: SERVER_SCHEMA_VERSION,
    sourceNodeId: identity?.nodeId ?? "web-uninitialized",
    records,
    changes,
    baseVector: {},
    lastVector: vectorFromChanges(changes),
  });
}

export async function createDeltaBackup(
  password: string,
  baseVector: BackupVector = {},
): Promise<Buffer> {
  const [identity] = await db
    .select({ nodeId: nodeIdentityTable.nodeId })
    .from(nodeIdentityTable)
    .limit(1);
  const allChanges = await collectChanges();
  const changes = allChanges.filter(
    (change) => change.originSequence > (baseVector[change.originNodeId] ?? 0),
  );
  const records = await collectCurrentRecordsForChanges(changes);
  return createSyncPackage({
    password,
    packageType: "delta-sync",
    schemaVersion: SERVER_SCHEMA_VERSION,
    sourceNodeId: identity?.nodeId ?? "web-uninitialized",
    records,
    changes,
    baseVector,
    lastVector: { ...baseVector, ...vectorFromChanges(changes) },
  });
}

export async function getLatestBackup() {
  const [entry] = await db
    .select()
    .from(backupCatalogTable)
    .where(eq(backupCatalogTable.status, "available"))
    .orderBy(desc(backupCatalogTable.createdAt))
    .limit(1);
  return entry;
}

export async function storeBackupPackage(
  packageBuffer: Buffer,
  password: string,
  options: { retentionClass?: "manual" | "daily" | "weekly" | "monthly" } = {},
) {
  const pkg = readSyncPackage(packageBuffer, password, { maxBytes: MAX_PACKAGE_BYTES });
  const entry = {
    id: randomUUID(),
    packageHash: pkg.packageHash,
    packageType: pkg.manifest.packageType === "delta-sync" ? "delta-sync" : "full-backup",
    sourceNodeId: pkg.manifest.sourceNodeId,
    baseVector: pkg.manifest.baseVector ?? {},
    lastVector: pkg.manifest.lastVector ?? {},
    retentionClass: options.retentionClass ?? "manual",
    recordCount: pkg.records.length,
    changeCount: pkg.changes.length,
    byteSize: packageBuffer.length,
    encryptedPackage: packageBuffer.toString("base64"),
  } as const;
  await db.insert(backupCatalogTable).values(entry);
  return { ...entry, summary: packageSummary(pkg) };
}

export async function listBackupCatalog() {
  return db
    .select({
      id: backupCatalogTable.id,
      packageHash: backupCatalogTable.packageHash,
      packageType: backupCatalogTable.packageType,
      sourceNodeId: backupCatalogTable.sourceNodeId,
      baseVector: backupCatalogTable.baseVector,
      lastVector: backupCatalogTable.lastVector,
      retentionClass: backupCatalogTable.retentionClass,
      recordCount: backupCatalogTable.recordCount,
      changeCount: backupCatalogTable.changeCount,
      byteSize: backupCatalogTable.byteSize,
      status: backupCatalogTable.status,
      lastVerifiedAt: backupCatalogTable.lastVerifiedAt,
      createdAt: backupCatalogTable.createdAt,
    })
    .from(backupCatalogTable)
    .where(eq(backupCatalogTable.status, "available"))
    .orderBy(desc(backupCatalogTable.createdAt));
}

export async function getCatalogBackup(id: string) {
  const [entry] = await db
    .select()
    .from(backupCatalogTable)
    .where(eq(backupCatalogTable.id, id))
    .limit(1);
  return entry;
}

export async function verifyCatalogBackup(id: string, password: string) {
  const entry = await getCatalogBackup(id);
  if (!entry) throw new Error("النسخة غير موجودة");
  try {
    const pkg = readSyncPackage(Buffer.from(entry.encryptedPackage, "base64"), password, {
      maxBytes: MAX_PACKAGE_BYTES,
    });
    if (pkg.packageHash !== entry.packageHash) throw new Error("بصمة النسخة لا تطابق الكتالوج");
    await db
      .update(backupCatalogTable)
      .set({ status: "available", lastVerifiedAt: new Date() })
      .where(eq(backupCatalogTable.id, id));
    return { id, packageHash: entry.packageHash, verified: true, summary: packageSummary(pkg) };
  } catch (error) {
    if (!(error instanceof SyncPackageError && error.code === "WRONG_PASSWORD")) {
      await db
        .update(backupCatalogTable)
        .set({ status: "invalid" })
        .where(eq(backupCatalogTable.id, id));
    }
    throw error;
  }
}

export async function getRetentionPolicy() {
  const [existing] = await db.select().from(backupRetentionPolicyTable).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(backupRetentionPolicyTable).values({ id: 1 }).returning();
  return created;
}

export async function updateRetentionPolicy(input: {
  dailyLimit?: number;
  weeklyLimit?: number;
  monthlyLimit?: number;
}) {
  const current = await getRetentionPolicy();
  const values = {
    dailyLimit: input.dailyLimit ?? current.dailyLimit,
    weeklyLimit: input.weeklyLimit ?? current.weeklyLimit,
    monthlyLimit: input.monthlyLimit ?? current.monthlyLimit,
  };
  if (Object.values(values).some((value) => !Number.isInteger(value) || value < 1 || value > 3650)) {
    throw new Error("حدود الاحتفاظ يجب أن تكون أعداداً صحيحة بين 1 و3650");
  }
  const [updated] = await db
    .update(backupRetentionPolicyTable)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(backupRetentionPolicyTable.id, current.id))
    .returning();
  return updated;
}

export async function enforceRetentionPolicy() {
  const policy = await getRetentionPolicy();
  const entries = await db
    .select()
    .from(backupCatalogTable)
    .where(eq(backupCatalogTable.status, "available"))
    .orderBy(desc(backupCatalogTable.createdAt));
  const limits = { daily: policy.dailyLimit, weekly: policy.weeklyLimit, monthly: policy.monthlyLimit };
  const protectedFullId = entries.find((entry) => entry.packageType === "full-backup")?.id;
  const deleted: string[] = [];
  for (const retentionClass of ["daily", "weekly", "monthly"] as const) {
    const candidates = entries.filter((entry) => entry.retentionClass === retentionClass);
    for (const [index, entry] of candidates.entries()) {
      if (index < limits[retentionClass] || entry.id === protectedFullId) continue;
      await db.delete(backupCatalogTable).where(eq(backupCatalogTable.id, entry.id));
      deleted.push(entry.id);
    }
  }
  return { deleted, kept: entries.length - deleted.length, policy };
}

export async function readCatalogPackage(id: string) {
  const entry = await getCatalogBackup(id);
  if (!entry) throw new Error("النسخة غير موجودة");
  return Buffer.from(entry.encryptedPackage, "base64");
}

export function decodePackage(packageBase64: string, password: string): SyncPackage {
  if (!packageBase64 || packageBase64.length > Math.ceil((MAX_PACKAGE_BYTES * 4) / 3) + 1024) {
    throw new Error("حجم حزمة المزامنة أكبر من الحد المسموح");
  }
  let buffer: Buffer;
  try {
    buffer = Buffer.from(packageBase64, "base64");
  } catch {
    throw new Error("ترميز الحزمة غير صالح");
  }
  return readSyncPackage(buffer, password, { maxBytes: MAX_PACKAGE_BYTES });
}

export type RestoreMode = "full" | "merge";
export type RestoreRecordResult = {
  entityType: string;
  localId?: number | null;
  status: "applied" | "duplicate" | "rejected" | "conflict" | "skipped";
  code?: string;
};
export type RestoreReport = {
  mode: RestoreMode;
  packageHash: string;
  packageType: string;
  counts: {
    total: number;
    applied: number;
    duplicate: number;
    rejected: number;
    conflict: number;
    skipped: number;
  };
  records: RestoreRecordResult[];
};

async function ensureBackupPreviewSchema() {
  // Older hosted and desktop databases may predate the preview migration.
  // Keep the restore flow self-healing and idempotent instead of turning a
  // successful dry run into a generic "restore failed" response.
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS "backup_restore_previews" (
      "token" text PRIMARY KEY NOT NULL,
      "package_hash" text NOT NULL,
      "mode" text NOT NULL,
      "report" jsonb NOT NULL,
      "expires_at" timestamptz NOT NULL,
      "created_at" timestamptz DEFAULT now() NOT NULL
    )
  `));
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS "backup_restore_previews_expires_idx"
      ON "backup_restore_previews" ("expires_at")
  `));
}

const USER_REFERENCE_COLUMNS = new Set([
  "created_by",
  "user_id",
]);

function normalizeUserReferences(
  data: Record<string, unknown>,
  availableUserIds: Set<number>,
  fallbackUserId: number | null,
) {
  if (!fallbackUserId) return { data, remapped: 0 };
  const normalized = { ...data };
  let remapped = 0;
  for (const column of USER_REFERENCE_COLUMNS) {
    const value = normalized[column];
    if (
      value != null &&
      typeof value === "number" &&
      Number.isInteger(value) &&
      !availableUserIds.has(value)
    ) {
      normalized[column] = fallbackUserId;
      remapped += 1;
    }
  }
  return { data: normalized, remapped };
}

function tableForEntity(entityType: string): BackupTable | undefined {
  return TABLES.find((table) => TABLE_ENTITY_TYPES[table] === entityType);
}

function validateRecord(record: SyncRecord): string | undefined {
  if (!record.data || typeof record.data !== "object" || Array.isArray(record.data)) {
    return "invalid-record-data";
  }
  if (typeof record.data.id !== "number" || !Number.isInteger(record.data.id) || record.data.id < 1) {
    return "invalid-primary-key";
  }
  if (record.entityType === "items") {
    const currentStock = Number(record.data.current_stock ?? 0);
    const minStock = Number(record.data.min_stock ?? 0);
    if (currentStock < 0 || minStock < 0) return "negative-item-balance";
  }
  if (record.entityType === "inventory_batches") {
    const received = Number(record.data.received_quantity);
    const remaining = Number(record.data.remaining_quantity);
    if (received <= 0 || remaining < 0 || remaining > received) return "invalid-batch-balance";
  }
  return undefined;
}

function insertStatement(table: BackupTable, data: Record<string, unknown>, updateOnConflict = false) {
  const columns = Object.keys(data).filter((column) => /^[a-z][a-z0-9_]*$/.test(column));
  if (columns.length === 0) throw new Error("empty-record");
  if (updateOnConflict) {
    const updateColumns = columns.filter((column) => column !== "id");
    if (updateColumns.length) {
      const assignments = sql.join(
        updateColumns.map((column) => sql.raw(`"${column}" = EXCLUDED."${column}"`)),
        sql`, `,
      );
      return sql`INSERT INTO ${sql.identifier(table)}
        (${sql.join(columns.map((column) => sql.identifier(column)), sql`, `)})
        VALUES (${sql.join(columns.map((column) => sql`${data[column]}`), sql`, `)})
        ON CONFLICT ("id") DO UPDATE SET ${assignments}`;
    }
  }
  return sql`INSERT INTO ${sql.identifier(table)}
    (${sql.join(columns.map((column) => sql.identifier(column)), sql`, `)})
    VALUES (${sql.join(columns.map((column) => sql`${data[column]}`), sql`, `)})
    ON CONFLICT DO NOTHING`;
}

async function deleteBusinessRows(tx: QueryExecutor) {
  for (const table of [...TABLES].reverse()) {
    await tx.execute(sql.raw(`DELETE FROM "${table}"`));
  }
}

async function synchronizeBusinessSequences(tx: QueryExecutor) {
  const sequenceTables = [
    ["categories", "categories"],
    ["items", "items"],
    ["equipment", "equipment"],
    ["recipients", "recipients"],
    ["exit_reasons", "exit_reasons"],
    ["transactions", "transactions"],
    ["inventory_batches", "inventory_batches"],
    ["transaction_batch_allocations", "transaction_batch_allocations"],
    ["personal_custodies", "personal_custodies"],
    ["custody_returns", "custody_returns"],
    ["damage_records", "damage_records"],
    ["central_returns", "central_returns"],
    ["audit_log", "audit_log"],
  ] as const;

  for (const [tableName, sequenceTable] of sequenceTables) {
    await tx.execute(sql.raw(
      `SELECT setval(pg_get_serial_sequence('${sequenceTable}', 'id'), COALESCE((SELECT MAX(id) FROM "${tableName}"), 1), true)`,
    ));
  }
}

function newReport(pkg: SyncPackage, mode: RestoreMode): RestoreReport {
  return {
    mode,
    packageHash: pkg.packageHash,
    packageType: pkg.manifest.packageType,
    counts: { total: pkg.records.length, applied: 0, duplicate: 0, rejected: 0, conflict: 0, skipped: 0 },
    records: [],
  };
}

export function previewRestore(pkg: SyncPackage, mode: RestoreMode): RestoreReport {
  const report = newReport(pkg, mode);
  for (const record of pkg.records) {
    const result: RestoreRecordResult = {
      entityType: record.entityType,
      localId: record.localId,
      status: "applied",
    };
    if (record.entityType === "users") {
      result.status = "skipped";
      result.code = "users-not-restored";
    } else if (!tableForEntity(record.entityType)) {
      result.status = "rejected";
      result.code = "unknown-entity-type";
    } else {
      const error = validateRecord(record);
      if (error) {
        result.status = "rejected";
        result.code = error;
      }
    }
    report.records.push(result);
    report.counts[result.status] += 1;
  }
  return report;
}

export async function applyRestore(
  pkg: SyncPackage,
  mode: RestoreMode,
  fallbackUserId?: number | null,
): Promise<RestoreReport> {
  const report = previewRestore(pkg, mode);
  if (report.counts.rejected > 0) {
    throw new Error("لا يمكن تطبيق حزمة تحتوي على سجلات مرفوضة؛ راجع المعاينة");
  }
  await db.transaction(async (tx) => {
    const existingUsers = await tx
      .select({ id: usersTable.id })
      .from(usersTable);
    const availableUserIds = new Set(existingUsers.map((user) => user.id));
    if (mode === "full") await deleteBusinessRows(tx);
    for (const record of pkg.records) {
      const result = report.records.find(
        (candidate) => candidate.entityType === record.entityType && candidate.localId === record.localId,
      );
      if (!result || result.status === "skipped") continue;
      const table = tableForEntity(record.entityType);
      if (!table) continue;
      try {
        const isDelta = pkg.manifest.packageType === "delta-sync";
        const normalized = normalizeUserReferences(
          record.data,
          availableUserIds,
          fallbackUserId ?? null,
        );
        const inserted = (await tx.execute(
          insertStatement(table, normalized.data, isDelta && mode === "merge"),
        )) as {
          rowCount?: number;
        };
        if (Number(inserted.rowCount ?? 0) > 0) {
          result.status = "applied";
        } else {
          result.status = "duplicate";
        }
      } catch (error) {
        if (mode === "full") throw error;
        result.status = "conflict";
        result.code = error instanceof Error ? error.message.slice(0, 160) : "database-conflict";
      }
    }
    // Restored rows can carry explicit IDs. Align serial sequences before the
    // next write so audit and business records cannot collide after restore.
    await synchronizeBusinessSequences(tx);
  });
  report.counts = { total: report.records.length, applied: 0, duplicate: 0, rejected: 0, conflict: 0, skipped: 0 };
  for (const record of report.records) report.counts[record.status] += 1;
  return report;
}

export async function createRestorePoint(userId: number | null, packageBuffer: Buffer, report: RestoreReport) {
  const id = randomUUID();
  await db.insert(backupRestorePointTable).values({
    id,
    packageHash: report.packageHash,
    encryptedPackage: packageBuffer.toString("base64"),
    createdBy: userId,
    summary: report,
  });
  return id;
}

export async function createPreview(pkg: SyncPackage, mode: RestoreMode) {
  await ensureBackupPreviewSchema();
  const report = previewRestore(pkg, mode);
  const token = randomUUID();
  await db.insert(backupRestorePreviewTable).values({
    token,
    packageHash: pkg.packageHash,
    mode,
    report,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });
  return { token, report, summary: packageSummary(pkg) };
}

export async function consumePreview(token: string, packageHash: string, mode: RestoreMode) {
  await ensureBackupPreviewSchema();
  const [preview] = await db
    .select()
    .from(backupRestorePreviewTable)
    .where(
      and(
        eq(backupRestorePreviewTable.token, token),
        eq(backupRestorePreviewTable.packageHash, packageHash),
        eq(backupRestorePreviewTable.mode, mode),
        gt(backupRestorePreviewTable.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!preview) throw new Error("المعاينة غير موجودة أو منتهية؛ يجب تنفيذ Dry Run جديد قبل الاستعادة");
  await db.delete(backupRestorePreviewTable).where(eq(backupRestorePreviewTable.token, token));
  return preview;
}

export async function getRestorePoint(id: string) {
  const [point] = await db
    .select()
    .from(backupRestorePointTable)
    .where(eq(backupRestorePointTable.id, id))
    .limit(1);
  return point;
}

export async function rollbackRestorePoint(id: string) {
  const point = await getRestorePoint(id);
  if (!point) throw new Error("نقطة الاستعادة غير موجودة");
  const pkg = readSyncPackage(Buffer.from(point.encryptedPackage, "base64"), RESTORE_POINT_PASSWORD, {
    maxBytes: MAX_PACKAGE_BYTES,
  });
  const report = await applyRestore(pkg, "full");
  await db
    .update(backupRestorePointTable)
    .set({ status: "rolled-back", rolledBackAt: new Date() })
    .where(eq(backupRestorePointTable.id, id));
  return report;
}

export function packageBufferToBase64(buffer: Buffer) {
  return buffer.toString("base64");
}

export function serverRestorePointPassword() {
  return RESTORE_POINT_PASSWORD;
}