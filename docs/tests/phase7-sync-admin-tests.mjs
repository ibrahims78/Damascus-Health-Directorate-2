#!/usr/bin/env node
/**
 * Phase 7 — multi-site synchronisation management.
 *
 * Asserts:
 *   - /api/sync/overview is admin-only
 *   - the overview exposes node identity, this site's warehouse, the outbox,
 *     conflicts and trusted peers
 *   - a local change is queued in the outbox (nothing waits for a manual run)
 *
 * Run:  node docs/tests/phase7-sync-admin-tests.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const apiDir = path.join(root, "artifacts", "api-server");
const dataDir = path.join(root, "docs", "tests", ".phase7-run", `run-${Date.now()}`);
fs.mkdirSync(dataDir, { recursive: true });
const PORT = 41988;
const base = `http://127.0.0.1:${PORT}`;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
}
const makeJar = () => ({ cookie: "" });
async function req(jar, method, p, body) {
  const res = await fetch(base + p, {
    method,
    headers: { "content-type": "application/json", ...(jar.cookie ? { cookie: jar.cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) jar.cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}
async function waitForApi(deadlineMs = 120000) {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    try { if ((await fetch(`${base}/api/healthz`)).ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

const child = spawn(process.execPath, ["--enable-source-maps", "./dist/index.mjs"], {
  cwd: apiDir,
  env: {
    ...process.env,
    DAMASCUS_DESKTOP: "1",
    DAMASCUS_SCHEMA_PATH: path.join(root, "lib", "db", "desktop-schema.sql"),
    DAMASCUS_DATA_DIR: dataDir,
    PORT: String(PORT),
    NODE_ENV: "test",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", () => {});
child.stderr.on("data", () => {});

let exitCode = 1;
try {
  if (!(await waitForApi())) throw new Error("API did not become ready");
  console.log("API ready\n");

  const admin = makeJar();
  await req(admin, "POST", "/api/auth/setup", { username: "admin", password: "Admin@1234567", fullName: "مدير" });
  await req(admin, "POST", "/api/users", { username: "wh1", password: "Warehouse@123", fullName: "أمين", role: "warehouse_manager" });
  const wh = makeJar();
  await req(wh, "POST", "/api/auth/login", { username: "wh1", password: "Warehouse@123" });

  check("overview requires authentication (401/403)", [401, 403].includes((await req(makeJar(), "GET", "/api/sync/overview")).status));
  check("overview is admin-only (403)", (await req(wh, "GET", "/api/sync/overview")).status === 403);

  const overview = await req(admin, "GET", "/api/sync/overview");
  check("overview responds (200)", overview.status === 200, `status=${overview.status}`);
  check("overview exposes the node identity", Boolean(overview.data?.node?.nodeId), `nodeId=${overview.data?.node?.nodeId}`);
  check("overview exposes this site's warehouse", Boolean(overview.data?.warehouse?.code), `code=${overview.data?.warehouse?.code}`);
  check("overview exposes the outbox", typeof overview.data?.outbox?.pending === "number", `pending=${overview.data?.outbox?.pending}`);
  check("overview reports zero open conflicts on a fresh node", Number(overview.data?.conflicts?.open) === 0, `open=${overview.data?.conflicts?.open}`);
  check("overview reports zero trusted peers on a fresh node", Number(overview.data?.peers?.trusted) === 0, `trusted=${overview.data?.peers?.trusted}`);

  const pendingBefore = Number(overview.data?.outbox?.pending ?? 0);

  // a local change must be queued for the next manual export
  const created = await req(admin, "POST", "/api/items", { code: "SYN-1", name: "مادة مزامنة", itemType: "consumable", unit: "قطعة" });
  check("local definition change succeeds (201)", created.status === 201, `status=${created.status}`);

  const after = await req(admin, "GET", "/api/sync/overview");
  const pendingAfter = Number(after.data?.outbox?.pending ?? 0);
  check("the change is queued in the outbox", pendingAfter > pendingBefore, `${pendingBefore} -> ${pendingAfter}`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  exitCode = failed.length === 0 ? 0 : 1;
} catch (error) {
  console.error("TEST RUN FAILED:", error);
  exitCode = 1;
} finally {
  child.kill();
  await new Promise((r) => setTimeout(r, 800));
}
process.exit(exitCode);
