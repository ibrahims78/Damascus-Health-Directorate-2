import { describe, expect, it } from "vitest";
import {
  REQUIRED_POSTGRES_COLUMNS,
  REQUIRED_POSTGRES_TABLES,
  formatReadinessFailure,
  getPostgresReadiness,
} from "./readiness-check";

function readyClient() {
  return {
    async query(text: string) {
      if (text.includes("current_database")) {
        return { rows: [{ database: "test", schema: "public" }] };
      }
      if (text.includes("information_schema.tables")) {
        return {
          rows: REQUIRED_POSTGRES_TABLES.map((table_name) => ({ table_name })),
        };
      }
      if (text.includes("information_schema.columns")) {
        return {
          rows: REQUIRED_POSTGRES_COLUMNS.map(([table_name, column_name]) => ({
            table_name,
            column_name,
          })),
        };
      }
      if (text.includes("to_regclass")) {
        return { rows: [{ migration_table: "drizzle.__drizzle_migrations" }] };
      }
      if (text.includes("count(*)")) {
        return { rows: [{ migration_count: 3 }] };
      }
      return { rows: [{ hash: "latest-hash", applied_at: "2026-09-17" }] };
    },
  };
}

describe("PostgreSQL schema readiness", () => {
  it("reports a migrated schema as ready with its latest migration", async () => {
    const readiness = await getPostgresReadiness(readyClient());

    expect(readiness).toMatchObject({
      status: "ready",
      mode: "postgres",
      schemaSource: "postgres-migrations",
      database: "test",
      migrationsApplied: 3,
      lastMigration: {
        hash: "latest-hash",
        appliedAt: "2026-09-17",
      },
    });
  });

  it("reports a clear migration failure for an uninitialized schema", async () => {
    const readiness = await getPostgresReadiness({
      async query(text: string) {
        if (text.includes("current_database")) {
          return { rows: [{ database: "test", schema: "public" }] };
        }
        if (text.includes("information_schema")) return { rows: [] };
        if (text.includes("to_regclass")) return { rows: [{ migration_table: null }] };
        return { rows: [] };
      },
    });

    expect(readiness.status).toBe("not_ready");
    expect(readiness.reason).toContain("missing tables");
    expect(formatReadinessFailure(readiness)).toContain(
      "pnpm --filter @workspace/db run db:migrate",
    );
  });
});