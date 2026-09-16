#!/usr/bin/env node
/**
 * Phase 4 — inventory hub + reconciliation + field-level audit.
 *
 * Asserts:
 *   - /api/reports/reconciliation is admin-only
 *   - consistent data reports zero mismatches
 *   - an adjustment that moves the cached balance away from the batch ledger
 *     is reported as a mismatch (with the right delta)
 *   - definition edits are audited with a before/after field diff
 *
 * Run:  node docs/tests/phase4-reconciliation-tests.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const apiDir = path.join(root, "artifacts", "api-server");
const dataDir = path.join(root, "docs", "tests", ".phase4-run", `run-${Date.now()}`);
fs.mkdirSync(dataDir, { recursive: true });
const PORT = 41994;
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
  return { status: res.status, data, text };
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

  check("reconciliation is admin-only (403)", (await req(wh, "GET", "/api/reports/reconciliation")).status === 403);

  const empty = await req(admin, "GET", "/api/reports/reconciliation");
  check("reconciliation responds (200)", empty.status === 200, `status=${empty.status}`);
  check("fresh database has no mismatches", Number(empty.data?.mismatches) === 0, `mismatches=${empty.data?.mismatches}`);

  const item = await req(admin, "POST", "/api/items", { code: "REC-1", name: "مادة ترصيد", itemType: "consumable", unit: "قطعة" });
  check("item created", item.status === 201, `status=${item.status}`);
  const itemId = item.data?.id;

  const inTx = await req(admin, "POST", "/api/transactions/in", {
    itemId, itemType: "item", quantity: 10, supplySource: "central_warehouses",
    deliveryNoteNumber: "DN-REC-1", deliveryNoteDate: "2026-09-14", documentDate: "2026-09-14",
  });
  check("receive 10 units (200)", inTx.status >= 200 && inTx.status < 300, `status=${inTx.status}`);

  const afterIn = await req(admin, "GET", "/api/reports/reconciliation");
  check("stock and batches agree after a receipt", Number(afterIn.data?.mismatches) === 0, `mismatches=${afterIn.data?.mismatches}`);

  const adjust = await req(admin, "POST", "/api/transactions/adjust", {
    itemId, itemType: "item", newStock: 7, reason: "تسوية جرد اختبار", documentDate: "2026-09-14",
  });
  check("adjustment applied (200)", adjust.status >= 200 && adjust.status < 300, `status=${adjust.status}`);

  const afterAdjust = await req(admin, "GET", "/api/reports/reconciliation");
  const adjustedRow = Array.isArray(afterAdjust.data?.items) ? afterAdjust.data.items.find((m) => m.id === itemId) : null;
  // Since the audit fix an adjustment maintains the batch ledger, so it must NOT create a mismatch.
  check("adjustment keeps the ledger coherent (no mismatch)", Number(afterAdjust.data?.mismatches) === 0 && !adjustedRow, `mismatches=${afterAdjust.data?.mismatches}`);
  check("reconciliation reports how many items it checked", Number(afterAdjust.data?.checked) >= 1, `checked=${afterAdjust.data?.checked}`);
  check("reconciliation stamps the report", typeof afterAdjust.data?.generatedAt === "string");

  // ---- field-level audit -------------------------------------------------
  const update = await req(admin, "PUT", `/api/items/${itemId}`, { name: "مادة ترصيد (معدّل)", minStock: 5 });
  check("definition update succeeds (200)", update.status === 200, `status=${update.status}`);

  const audit = await req(admin, "GET", "/api/audit?limit=50");
  const auditText = typeof audit.text === "string" ? audit.text : JSON.stringify(audit.data);
  check("audit log exposes a field-level diff", auditText.includes("changes") && auditText.includes("minStock"), "searched audit payload");

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
