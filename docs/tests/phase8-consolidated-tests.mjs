#!/usr/bin/env node
/**
 * Phase 8 — consolidated reporting.
 *
 * Asserts:
 *   - /api/reports/consolidated is admin-only
 *   - totals aggregate every warehouse
 *   - per-warehouse lines/quantities follow the actual stock
 *   - below-minimum is evaluated per warehouse against the shared min stock
 *
 * Run:  node docs/tests/phase8-consolidated-tests.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const apiDir = path.join(root, "artifacts", "api-server");
const dataDir = path.join(root, "docs", "tests", ".phase8-run", `run-${Date.now()}`);
fs.mkdirSync(dataDir, { recursive: true });
const PORT = 41987;
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

  check("consolidated report is admin-only (403)", (await req(wh, "GET", "/api/reports/consolidated")).status === 403);

  const empty = await req(admin, "GET", "/api/reports/consolidated");
  check("consolidated responds (200)", empty.status === 200, `status=${empty.status}`);
  check("one warehouse on a fresh node", Number(empty.data?.totals?.warehouses) === 1, `warehouses=${empty.data?.totals?.warehouses}`);

  const warehouses = (await req(admin, "GET", "/api/warehouses")).data;
  const central = warehouses.find((w) => w.type === "central");
  const branch = (await req(admin, "POST", "/api/warehouses", { code: "S01", name: "فرع S01", type: "branch" })).data;

  const item = (await req(admin, "POST", "/api/items", { code: "CON-1", name: "مادة موحّدة", itemType: "consumable", unit: "قطعة", minStock: 8 })).data;
  await req(admin, "POST", "/api/transactions/in", {
    itemId: item.id, itemType: "item", quantity: 10, supplySource: "central_warehouses",
    deliveryNoteNumber: "DN-CON-1", deliveryNoteDate: "2026-09-14", documentDate: "2026-09-14",
  });

  const afterIn = await req(admin, "GET", "/api/reports/consolidated");
  check("totals count the received quantity", Number(afterIn.data?.totals?.quantity) === 10, `qty=${afterIn.data?.totals?.quantity}`);
  const centralRow = (afterIn.data?.warehouses ?? []).find((w) => w.warehouseId === central.id);
  check("central row carries the balance", Number(centralRow?.quantity) === 10, `qty=${centralRow?.quantity}`);

  const transfer = (await req(admin, "POST", "/api/transfers", {
    fromWarehouseId: central.id, toWarehouseId: branch.id, items: [{ itemId: item.id, quantity: 5 }],
  })).data;
  await req(admin, "POST", `/api/transfers/${transfer.id}/issue`);
  await req(admin, "POST", `/api/transfers/${transfer.id}/receive`, { deliveryNoteNumber: "DN-CON-T1" });

  const afterTransfer = await req(admin, "GET", "/api/reports/consolidated");
  const c = (afterTransfer.data?.warehouses ?? []).find((w) => w.warehouseId === central.id);
  const b = (afterTransfer.data?.warehouses ?? []).find((w) => w.warehouseId === branch.id);
  check("central keeps the reduced balance", Number(c?.quantity) === 5, `qty=${c?.quantity}`);
  check("branch shows the received balance", Number(b?.quantity) === 5, `qty=${b?.quantity}`);
  check("totals stay consistent after the transfer", Number(afterTransfer.data?.totals?.quantity) === 10, `qty=${afterTransfer.data?.totals?.quantity}`);
  check("below-minimum is evaluated per warehouse", Number(afterTransfer.data?.totals?.belowMin) === 2, `belowMin=${afterTransfer.data?.totals?.belowMin}`);
  check("both warehouses are listed", Number(afterTransfer.data?.totals?.warehouses) === 2, `warehouses=${afterTransfer.data?.totals?.warehouses}`);

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
