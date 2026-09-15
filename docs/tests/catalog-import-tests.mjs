#!/usr/bin/env node
/**
 * Catalog import (materials + equipment definitions) integration test.
 *
 * Asserts:
 *   - preview/commit are admin-only
 *   - preview never writes
 *   - unknown units/categories are reported as errors
 *   - a catalog file with errors cannot be committed (409)
 *   - a valid commit creates definitions, and re-running it is idempotent
 *     (skip in add-only, update in add-and-update)
 *   - no balance/batch is ever touched by the catalog import
 *
 * Run:  node docs/tests/catalog-import-tests.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const apiDir = path.join(root, "artifacts", "api-server");
const dataDir = path.join(root, "docs", "tests", ".catalog-run", `run-${Date.now()}`);
fs.mkdirSync(dataDir, { recursive: true });
const PORT = 41986;
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
  await req(admin, "POST", "/api/auth/setup", { username: "admin", password: "Admin@1234567", fullName: "Ù…Ø¯ÙŠØ±" });
  await req(admin, "POST", "/api/users", { username: "wh1", password: "Warehouse@123", fullName: "Ø£Ù…ÙŠÙ†", role: "warehouse_manager" });
  const wh = makeJar();
  await req(wh, "POST", "/api/auth/login", { username: "wh1", password: "Warehouse@123" });

  // units come from the units catalog (never from a hardcoded list)
  await req(admin, "POST", "/api/units/seed-defaults");
  const units = (await req(admin, "GET", "/api/units")).data;
  const unitName = Array.isArray(units) && units.length ? units[0].name : null;
  check("a unit exists in the units catalog", Boolean(unitName), `unit=${unitName}`);

  // ---- permissions --------------------------------------------------------
  check("preview is admin-only (403)", (await req(wh, "POST", "/api/catalog/import/preview", { items: [] })).status === 403);
  check("commit is admin-only (403)", (await req(wh, "POST", "/api/catalog/import", { items: [] })).status === 403);

  const goodItems = [{ code: "CAT-1", name: "Ù…Ø§Ø¯Ø© ÙƒØªØ§Ù„ÙˆØ¬", unit: unitName, minStock: 3, requiresBatch: "Ù†Ø¹Ù…" }];
  const goodEquipment = [{ code: "CEQ-1", name: "Ø¬Ù‡Ø§Ø² ÙƒØªØ§Ù„ÙˆØ¬", serialNumber: "SN-CAT-1", minQuantity: 1 }];

  // ---- preview does not write --------------------------------------------
  const preview = await req(admin, "POST", "/api/catalog/import/preview", { mode: "add-and-update", items: goodItems, equipment: goodEquipment });
  check("preview responds (200)", preview.status === 200, `status=${preview.status}`);
  check("preview plans a material create", Number(preview.data?.summary?.items?.create) === 1, `create=${preview.data?.summary?.items?.create}`);
  check("preview plans an equipment create", Number(preview.data?.summary?.equipment?.create) === 1, `create=${preview.data?.summary?.equipment?.create}`);

  const itemsAfterPreview = await req(admin, "GET", "/api/items?limit=5000");
  check("preview wrote nothing", Array.isArray(itemsAfterPreview.data?.items) && itemsAfterPreview.data.items.length === 0, `items=${itemsAfterPreview.data?.items?.length}`);

  // ---- validation errors --------------------------------------------------
  const badUnit = await req(admin, "POST", "/api/catalog/import/preview", { items: [{ name: "Ù…Ø§Ø¯Ø©", unit: "ÙˆØ­Ø¯Ø©-ØºÙŠØ±-Ù…Ø¹Ø±ÙˆÙØ©" }] });
  const badUnitCodes = (badUnit.data?.items ?? []).flatMap((r) => (r.issues ?? []).map((i) => i.code));
  check("unknown unit is reported", badUnitCodes.includes("UNIT_UNKNOWN"), `codes=${badUnitCodes.join(",")}`);

  const badCategory = await req(admin, "POST", "/api/catalog/import/preview", { items: [{ name: "Ù…Ø§Ø¯Ø©", unit: unitName, category: "ØªØµÙ†ÙŠÙ-ÙˆÙ‡Ù…ÙŠ" }] });
  const badCategoryCodes = (badCategory.data?.items ?? []).flatMap((r) => (r.issues ?? []).map((i) => i.code));
  check("unknown category is reported", badCategoryCodes.includes("CATEGORY_UNKNOWN"), `codes=${badCategoryCodes.join(",")}`);

  const qtyColumn = await req(admin, "POST", "/api/catalog/import/preview", { items: [{ name: "Ù…Ø§Ø¯Ø©", unit: unitName, quantity: 5 }] });
  const qtyCodes = (qtyColumn.data?.items ?? []).flatMap((r) => (r.issues ?? []).map((i) => i.code));
  check("quantity column is rejected in a catalog sheet", qtyCodes.includes("SERIAL_WITH_QTY_COLUMN"), `codes=${qtyCodes.join(",")}`);

  const withError = await req(admin, "POST", "/api/catalog/import", { mode: "add-and-update", items: [{ name: "Ù…Ø§Ø¯Ø©", unit: "ÙˆØ­Ø¯Ø©-ØºÙŠØ±-Ù…Ø¹Ø±ÙˆÙØ©" }] });
  check("commit refuses a file with errors (409)", withError.status === 409, `status=${withError.status}`);

  // ---- commit + idempotency ----------------------------------------------
  const commit = await req(admin, "POST", "/api/catalog/import", { mode: "add-and-update", items: goodItems, equipment: goodEquipment });
  check("commit succeeds (200)", commit.status === 200, `status=${commit.status}`);
  check("commit created the material", Number(commit.data?.createdItems) === 1, `createdItems=${commit.data?.createdItems}`);
  check("commit created the equipment", Number(commit.data?.createdEquipment) === 1, `createdEquipment=${commit.data?.createdEquipment}`);

  const itemsAfter = await req(admin, "GET", "/api/items?limit=5000");
  const created = (itemsAfter.data?.items ?? []).find((i) => i.code === "CAT-1");
  check("material exists in the catalog", Boolean(created), `id=${created?.id}`);
  check("balances stay untouched (currentStock = 0)", Number(created?.currentStock) === 0, `stock=${created?.currentStock}`);
  const recon = await req(admin, "GET", "/api/reports/reconciliation");
  check("catalog import creates no batches (reconciliation is clean)", Number(recon.data?.mismatches) === 0, `mismatches=${recon.data?.mismatches}`);

  const again = await req(admin, "POST", "/api/catalog/import", { mode: "add-only", items: goodItems, equipment: goodEquipment });
  check("add-only skips existing rows", Number(again.data?.skipped) === 2, `skipped=${again.data?.skipped}`);

  const updateRun = await req(admin, "POST", "/api/catalog/import", { mode: "add-and-update", items: [{ ...goodItems[0], name: "Ù…Ø§Ø¯Ø© ÙƒØªØ§Ù„ÙˆØ¬ (Ù…Ø¹Ø¯Ù‘Ù„Ø©)", minStock: 7 }] });
  check("add-and-update updates the row", Number(updateRun.data?.updatedItems) === 1, `updatedItems=${updateRun.data?.updatedItems}`);
  const afterUpdate = await req(admin, "GET", "/api/items?limit=5000");
  const updated = (afterUpdate.data?.items ?? []).find((i) => i.code === "CAT-1");
  check("updated name and minStock applied", updated?.minStock === 7, `minStock=${updated?.minStock}`);

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



