export const REQUIRED_POSTGRES_TABLES = [
  "users",
  "system_settings",
  "categories",
  "units",
  "import_batches",
  "document_sequences",
  "warehouses",
  "transfer_lines",
  "transfers",
  "items",
  "equipment",
  "recipients",
  "exit_reasons",
  "transactions",
  "inventory_batches",
  "transaction_batch_allocations",
  "personal_custodies",
  "central_returns",
  "custody_returns",
  "damage_records",
  "audit_log",
  "alert_reads",
  "alerts",
  "node_identity",
  "sync_change_log",
  "sync_conflicts",
  "sync_entity_ids",
  "sync_inbox",
  "sync_outbox",
  "sync_cursors",
  "sync_tombstones",
  "sync_pairings",
  "sync_relay_packages",
  "sync_session_packages",
  "sync_sessions",
  "sync_trusted_nodes",
  "auth_rate_limits",
  "backup_catalog",
  "backup_restore_points",
  "backup_restore_previews",
  "backup_retention_policy",
  "license_state",
  "count_lines",
  "count_sessions",
  "receipt_lines",
  "receipts",
  "bins",
];

export const REQUIRED_POSTGRES_COLUMNS = [
  ["system_settings", "setup_completed"],
  ["items", "requires_expiry_tracking"],
  ["items", "requires_batch_tracking"],
  ["inventory_batches", "supplier"],
  ["transactions", "operation_id"],
  ["node_identity", "installation_id"],
] as const;

const EXPECTED_MIGRATION_COUNT = 3;

type Queryable = {
  query: (text: string, values?: unknown[]) => Promise<{
    rows: Array<Record<string, unknown>>;
  }>;
};

export type DatabaseReadiness = {
  status: "ready" | "not_ready";
  mode: "desktop" | "postgres";
  schemaSource: "desktop-schema.sql" | "postgres-migrations";
  database?: string;
  schema?: string;
  missingTables?: string[];
  missingColumns?: string[];
  migrationsApplied?: number;
  lastMigration?: {
    hash: string;
    appliedAt: string;
  };
  reason?: string;
};

export async function getPostgresReadiness(
  client: Queryable,
): Promise<DatabaseReadiness> {
  try {
    const databaseResult = await client.query(
      "SELECT current_database() AS database, current_schema() AS schema",
    );
    const connection = databaseResult.rows[0] ?? {};

    const tablesResult = await client.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [REQUIRED_POSTGRES_TABLES],
    );
    const foundTables = new Set(
      tablesResult.rows.map((row) => String(row.table_name)),
    );
    const missingTables = REQUIRED_POSTGRES_TABLES.filter(
      (table) => !foundTables.has(table),
    );

    const columnsResult = await client.query(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND (table_name, column_name) IN (
           SELECT * FROM unnest($1::text[], $2::text[])
         )`,
      [
        REQUIRED_POSTGRES_COLUMNS.map(([table]) => table),
        REQUIRED_POSTGRES_COLUMNS.map(([, column]) => column),
      ],
    );
    const foundColumns = new Set(
      columnsResult.rows.map(
        (row) => `${String(row.table_name)}.${String(row.column_name)}`,
      ),
    );
    const missingColumns = REQUIRED_POSTGRES_COLUMNS.map(
      ([table, column]) => `${table}.${column}`,
    ).filter((column) => !foundColumns.has(column));

    const migrationTableResult = await client.query(
      "SELECT to_regclass('drizzle.__drizzle_migrations') AS migration_table",
    );
    const migrationTableExists = Boolean(
      migrationTableResult.rows[0]?.migration_table,
    );
    let migrationsApplied = 0;
    let lastMigration: DatabaseReadiness["lastMigration"];

    if (migrationTableExists) {
      const migrationCountResult = await client.query(
        "SELECT count(*)::int AS migration_count FROM drizzle.__drizzle_migrations",
      );
      migrationsApplied = Number(
        migrationCountResult.rows[0]?.migration_count ?? 0,
      );
      const migrationResult = await client.query(
        `SELECT hash, created_at::text AS applied_at
         FROM drizzle.__drizzle_migrations
         ORDER BY created_at DESC
         LIMIT 1`,
      );
      const latest = migrationResult.rows[0];
      if (latest) {
        lastMigration = {
          hash: String(latest.hash),
          appliedAt: String(latest.applied_at),
        };
      }
    }

    const reasons = [
      missingTables.length > 0
        ? `missing tables: ${missingTables.join(", ")}`
        : undefined,
      missingColumns.length > 0
        ? `missing columns: ${missingColumns.join(", ")}`
        : undefined,
      !migrationTableExists
        ? "migration history table drizzle.__drizzle_migrations is missing"
        : undefined,
      migrationsApplied < EXPECTED_MIGRATION_COUNT
        ? `expected at least ${EXPECTED_MIGRATION_COUNT} applied migrations, found ${migrationsApplied}`
        : undefined,
    ].filter((reason): reason is string => Boolean(reason));

    return {
      status: reasons.length === 0 ? "ready" : "not_ready",
      mode: "postgres",
      schemaSource: "postgres-migrations",
      database: String(connection.database ?? ""),
      schema: String(connection.schema ?? ""),
      ...(missingTables.length > 0 ? { missingTables } : {}),
      ...(missingColumns.length > 0 ? { missingColumns } : {}),
      migrationsApplied,
      ...(lastMigration ? { lastMigration } : {}),
      ...(reasons.length > 0 ? { reason: reasons.join("; ") } : {}),
    };
  } catch (error) {
    return {
      status: "not_ready",
      mode: "postgres",
      schemaSource: "postgres-migrations",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function formatReadinessFailure(readiness: DatabaseReadiness): string {
  return [
    "PostgreSQL schema is not ready.",
    readiness.reason ?? "run the documented migration command first",
    "Command: pnpm --filter @workspace/db run db:migrate",
  ].join(" ");
}