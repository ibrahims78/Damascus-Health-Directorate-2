#!/usr/bin/env node
/**
 * Phase 3 — import governance integration test.
 *
 * Asserts:
 *   - the import journal is admin-only (list + rollback)
 *   - a committed items import is journaled with its counts and a batch id
 *   - rollback archives the rows created by that import
 *   - a second rollback is rejected (409)
 *   - rollback of an upsert restores the previous values
 *   - an equipment import is journaled and rollback archives its rows
 *
 * Run:  node docs/tests/phase3-import-governance-tests.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const apiDir = path.join(root, "artifacts", "api-server");
const dataDir = path.join(root, "docs", "tests", ".phase3-run", `run-${Date.now()}`);
fs.mkdirSync(dataDir, { recursive: true });
const PORT = 41995;
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

  // ---- journal is admin-only ---------------------------------------------
  check("warehouse_manager CANNOT list import batches (403)", (await req(wh, "GET", "/api/import-batches")).status === 403);
  check("warehouse_manager CANNOT rollback (403)", (await req(wh, "POST", "/api/import-batches/1/rollback")).status === 403);

  // ---- items import is journaled ------------------------------------------
  const importRows = [
    { code: "IMP-1", name: "مادة مستوردة 1", unit: "قطعة", minStock: 2 },
    { code: "IMP-2", name: "مادة مستوردة 2", unit: "قطعة", minStock: 3 },
  ];
  const imp = await req(admin, "POST", "/api/items/bulk-import", importRows);
  check("items bulk-import succeeds (200)", imp.status === 200, `status=${imp.status}`);
  check("import returns a batch id", Number.isFinite(Number(imp.data?.batchId)), `batchId=${imp.data?.batchId}`);
  check("import created 2 items", Number(imp.data?.created) === 2, `created=${imp.data?.created}`);

  const batches = await req(admin, "GET", "/api/import-batches");
  const list = Array.isArray(batches.data) ? batches.data : [];
  check("journal lists the batch", list.length === 1 && list[0].id === imp.data?.batchId, `count=${list.length}`);
  check("batch records counts", Number(list[0]?.createdCount) === 2, `created=${list[0]?.createdCount}`);

  // ---- rollback archives the created rows ---------------------------------
  const rb = await req(admin, "POST", `/api/import-batches/${imp.data?.batchId}/rollback`);
  check("rollback succeeds", rb.status === 200 && Number(rb.data?.archived) === 2, `archived=${rb.data?.archived}`);
  const afterRollback = await req(admin, "GET", "/api/items?limit=5000");
  const imported = Array.isArray(afterRollback.data?.items)
    ? afterRollback.data.items.filter((i) => (i.code ?? "").startsWith("IMP-"))
    : [{}];
  check("rolled-back items are archived", imported.length === 0, `visible=${imported.length}`);

  const rbAgain = await req(admin, "POST", `/api/import-batches/${imp.data?.batchId}/rollback`);
  check("second rollback rejected (409)", rbAgain.status === 409, `status=${rbAgain.status}`);

  // ---- upsert rollback restores previous values ---------------------------
  const base = await req(admin, "POST", "/api/items", { code: "UPS-1", name: "الاسم الأصلي", itemType: "consumable", unit: "قطعة" });
  const upsert = await req(admin, "POST", "/api/items/bulk-import?mode=upsert", [
    { code: "UPS-1", name: "الاسم المعدّل", unit: "قطعة", minStock: 9 },
  ]);
  check("upsert import updates the item", upsert.status === 200 && Number(upsert.data?.updated) === 1, `updated=${upsert.data?.updated}`);
  const afterUpsert = await req(admin, "GET", `/api/items/${base.data?.id}`);
  check("item shows the imported name", afterUpsert.data?.name === "الاسم المعدّل", `name=${afterUpsert.data?.name}`);

  const rbUpsert = await req(admin, "POST", `/api/import-batches/${upsert.data?.batchId}/rollback`);
  check("upsert rollback restores 1 row", rbUpsert.status === 200 && Number(rbUpsert.data?.restored) === 1, `restored=${rbUpsert.data?.restored}`);
  const restored = await req(admin, "GET", `/api/items/${base.data?.id}`);
  check("item name restored to previous value", restored.data?.name === "الاسم الأصلي", `name=${restored.data?.name}`);
  check("item minStock restored", Number(restored.data?.minStock) === 0, `minStock=${restored.data?.minStock}`);

  // ---- equipment import is journaled + rollbackable -----------------------
  const eqImp = await req(admin, "POST", "/api/equipment/bulk-import", [
    { code: "EQX-1", name: "جهاز مستورد 1", condition: "good" },
    { code: "EQX-2", name: "جهاز مستورد 2", condition: "good" },
  ]);
  check("equipment bulk-import succeeds (200)", eqImp.status === 200, `status=${eqImp.status}`);
  check("equipment import returns a batch id", Number.isFinite(Number(eqImp.data?.batchId)), `batchId=${eqImp.data?.batchId}`);
  const eqRb = await req(admin, "POST", `/api/import-batches/${eqImp.data?.batchId}/rollback`);
  check("equipment rollback archives rows", eqRb.status === 200 && Number(eqRb.data?.archived) === 2, `archived=${eqRb.data?.archived}`);
  const eqList = await req(admin, "GET", "/api/equipment?limit=5000");
  const eqVisible = Array.isArray(eqList.data?.equipment)
    ? eqList.data.equipment.filter((e) => (e.code ?? "").startsWith("EQX-"))
    : [{}];
  check("rolled-back equipment archived", eqVisible.length === 0, `visible=${eqVisible.length}`);

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
