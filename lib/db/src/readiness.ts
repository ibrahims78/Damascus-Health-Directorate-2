import pg from "pg";
import {
  formatReadinessFailure,
  getPostgresReadiness,
} from "./readiness-check";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error(
    "DATABASE_URL is required. This command validates the hosted PostgreSQL path only; Desktop uses desktop-schema.sql at boot.",
  );
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });
try {
  const readiness = await getPostgresReadiness(pool);
  console.log(JSON.stringify(readiness, null, 2));
  if (readiness.status !== "ready") {
    console.error(formatReadinessFailure(readiness));
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}