#!/usr/bin/env node
/**
 * Phase 5 — warehouse model integration test.
 *
 * Asserts:
 *   - a default central warehouse exists after boot and is the current one
 *   - warehouse reads are open, writes are admin-only
 *   - warehouse codes are unique
 *   - switching the current warehouse works
 *   - new movements get a per-warehouse, globally-unique document number
 *     (CODE-TYPE-YEAR-NNNNNN) and the per-warehouse counter advances
 *
 * Run:  node docs/tests/phase5-warehouse-tests.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const apiDir = path.join(root, "artifacts", "api-server");
const dataDir = path.join(root, "docs", "tests", ".phase5-run", `run-${Date.now()}`);
fs.mkdirSync(dataDir, { recursive: true });
const PORT = 41993;
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

  // ---- default warehouse exists ------------------------------------------
  const list = await req(admin, "GET", "/api/warehouses");
  const warehouses = Array.isArray(list.data) ? list.data : [];
  check("a default warehouse exists after boot", warehouses.length >= 1, `count=${warehouses.length}`);
  const central = warehouses.find((w) => w.type === "central");
  check("default warehouse is central", Boolean(central), `code=${central?.code}`);
  check("default warehouse code is C", central?.code === "C", `code=${central?.code}`);

  const current = await req(admin, "GET", "/api/warehouses/current");
  check("current warehouse is the central one", current.data?.id === central?.id, `current=${current.data?.code}`);

  // ---- permissions -------------------------------------------------------
  check("warehouse_manager reads warehouses (200)", (await req(wh, "GET", "/api/warehouses")).status === 200);
  check("warehouse_manager reads current (200)", (await req(wh, "GET", "/api/warehouses/current")).status === 200);
  check("warehouse_manager CANNOT create warehouse (403)", (await req(wh, "POST", "/api/warehouses", { code: "S99", name: "فرع" })).status === 403);
  check("warehouse_manager CANNOT switch current (403)", (await req(wh, "POST", "/api/warehouses/current", { id: central?.id })).status === 403);

  // ---- uniqueness + switch ----------------------------------------------
  const branch = await req(admin, "POST", "/api/warehouses", { code: "S01", name: "فرع تجريبي", type: "branch" });
  check("admin creates a branch warehouse (201)", branch.status === 201, `status=${branch.status}`);
  const dup = await req(admin, "POST", "/api/warehouses", { code: "S01", name: "مكرر" });
  check("duplicate warehouse code rejected (409)", dup.status === 409, `status=${dup.status}`);
  const switchRes = await req(admin, "POST", "/api/warehouses/current", { id: branch.data?.id });
  check("admin switches the current warehouse (200)", switchRes.status === 200 && switchRes.data?.code === "S01", `code=${switchRes.data?.code}`);
  const currentAfter = await req(admin, "GET", "/api/warehouses/current");
  check("current warehouse reflects the switch", currentAfter.data?.code === "S01", `code=${currentAfter.data?.code}`);

  // ---- document numbering -------------------------------------------------
  const next1 = await req(admin, "GET", "/api/warehouses/next-document-number?type=IN");
  check("next document number is warehouse-prefixed", /^S01-IN-\d{4}-\d{6}$/.test(String(next1.data?.documentNumber)), `number=${next1.data?.documentNumber}`);
  const next2 = await req(admin, "GET", "/api/warehouses/next-document-number?type=IN");
  const n1 = Number(String(next1.data?.documentNumber).split("-").pop());
  const n2 = Number(String(next2.data?.documentNumber).split("-").pop());
  check("per-warehouse counter advances", n2 === n1 + 1, `${n1} -> ${n2}`);

  // a real movement uses the same convention
  const item = await req(admin, "POST", "/api/items", { code: "WH-1", name: "مادة مستودع", itemType: "consumable", unit: "قطعة" });
  const inTx = await req(admin, "POST", "/api/transactions/in", {
    itemId: item.data?.id, itemType: "item", quantity: 4, supplySource: "central_warehouses",
    deliveryNoteNumber: "DN-WH-1", deliveryNoteDate: "2026-09-14", documentDate: "2026-09-14",
  });
  const docNumber = String(inTx.data?.documentNumber ?? "");
  check("movement document number is warehouse-prefixed", /^S01-IN-\d{4}-\d{6}$/.test(docNumber), `documentNumber=${docNumber}`);
  const nMove = Number(docNumber.split("-").pop());
  check("movement shares the warehouse counter", nMove === n2 + 1, `${n2} -> ${nMove}`);

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
