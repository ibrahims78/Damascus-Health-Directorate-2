import { defineConfig } from "drizzle-kit";

/**
 * Production migration pipeline (hosted PostgreSQL).
 *
 * Desktop/offline builds keep using the bundled desktop-schema.sql (executed
 * idempotently at boot); this config drives `drizzle-kit generate` /
 * `drizzle-kit migrate` for server deployments:
 *
 *   pnpm --filter @workspace/db db:generate   # diff schema -> migrations/
 *   pnpm --filter @workspace/db db:migrate    # apply migrations
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
});
