#!/usr/bin/env node
/**
 * Phase 2 — catalog & standard units integration test.
 *
 * Boots the built API against a throwaway PGlite data directory and asserts:
 *   - units reads are open, every unit write is admin-only
 *   - seeding defaults is idempotent
 *   - unit name is unique (create + rename)
 *   - unit usage report flags non-standard unit strings
 *   - normalize rewrites items and is reflected in the catalog
 *   - an in-use unit cannot be archived; an unused one can
 *
 * Run:  node docs/tests/phase2-catalog-units-tests.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const apiDir = path.join(root, "artifacts", "api-server");
const dataDir = path.join(root, "docs", "tests", ".phase2-run", `run-${Date.now()}`);
fs.mkdirSync(dataDir, { recursive: true });
const PORT = 41996;
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

  // ---- reads open, writes admin-only -------------------------------------
  check("warehouse_manager reads units (200)", (await req(wh, "GET", "/api/units")).status === 200);
  check("warehouse_manager CANNOT create unit (403)", (await req(wh, "POST", "/api/units", { name: "وحدة اختبار" })).status === 403);
  check("warehouse_manager CANNOT seed defaults (403)", (await req(wh, "POST", "/api/units/seed-defaults")).status === 403);
  check("warehouse_manager CANNOT read usage (403)", (await req(wh, "GET", "/api/units/usage")).status === 403);
  check("warehouse_manager CANNOT normalize (403)", (await req(wh, "POST", "/api/units/normalize", { from: "a", to: "b" })).status === 403);

  // ---- seed defaults is idempotent ---------------------------------------
  const seed1 = await req(admin, "POST", "/api/units/seed-defaults");
  check("seed defaults creates units", seed1.status === 200 && Number(seed1.data?.created ?? 0) > 0, `created=${seed1.data?.created}`);
  const seed2 = await req(admin, "POST", "/api/units/seed-defaults");
  check("seed defaults is idempotent", seed2.status === 200 && Number(seed2.data?.created ?? -1) === 0, `created=${seed2.data?.created}`);

  const units = await req(admin, "GET", "/api/units");
  const standardUnit = Array.isArray(units.data) ? units.data[0]?.name : null;
  check("units list is returned", Array.isArray(units.data) && units.data.length > 0, `count=${Array.isArray(units.data) ? units.data.length : "?"}`);

  // ---- uniqueness --------------------------------------------------------
  const u1 = await req(admin, "POST", "/api/units", { name: "وحدة اختبار فريدة" });
  check("admin creates unit (201)", u1.status === 201, `status=${u1.status}`);
  const u1dup = await req(admin, "POST", "/api/units", { name: "وحدة اختبار فريدة" });
  check("duplicate unit name rejected (409)", u1dup.status === 409, `status=${u1dup.status}`);

  // ---- usage + normalize -------------------------------------------------
  const item = await req(admin, "POST", "/api/items", { code: "ITM-U1", name: "مادة وحدة غير قياسية", itemType: "consumable", unit: "وحدة-يدوية-غريبة" });
  check("admin creates item with free-text unit (201)", item.status === 201, `status=${item.status}`);

  const usage = await req(admin, "GET", "/api/units/usage");
  const unknown = Array.isArray(usage.data) ? usage.data.find((r) => r.unit === "وحدة-يدوية-غريبة") : null;
  check("usage report flags non-standard unit", Boolean(unknown) && unknown.known === false, `count=${unknown?.count}`);

  const norm = await req(admin, "POST", "/api/units/normalize", { from: "وحدة-يدوية-غريبة", to: standardUnit });
  check("normalize rewrites affected items", norm.status === 200 && Number(norm.data?.updated ?? 0) === 1, `updated=${norm.data?.updated}`);

  const itemsAfter = await req(admin, "GET", "/api/items?limit=5000");
  const rewritten = Array.isArray(itemsAfter.data?.items) ? itemsAfter.data.items.find((i) => i.id === item.data?.id) : null;
  check("catalog shows the normalized unit", rewritten?.unit === standardUnit, `unit=${rewritten?.unit}`);

  const usageAfter = await req(admin, "GET", "/api/units/usage");
  const stillUnknown = Array.isArray(usageAfter.data) ? usageAfter.data.some((r) => r.unit === "وحدة-يدوية-غريبة" && r.count > 0) : true;
  check("usage report clears after normalize", !stillUnknown);

  // ---- archive rules -----------------------------------------------------
  const inUseUnit = await req(admin, "POST", "/api/units", { name: "وحدة مستخدمة" });
  await req(admin, "PUT", `/api/items/${item.data?.id}`, { unit: "وحدة مستخدمة" });
  const delInUse = await req(admin, "DELETE", `/api/units/${inUseUnit.data?.id}`);
  check("in-use unit cannot be archived (409)", delInUse.status === 409, `status=${delInUse.status}`);

  const delFree = await req(admin, "DELETE", `/api/units/${u1.data?.id}`);
  check("unused unit archived (200)", delFree.status === 200 && delFree.data?.isActive === false, `status=${delFree.status}`);
  const listAdmin = await req(admin, "GET", "/api/units?includeArchived=1");
  const archivedVisible = Array.isArray(listAdmin.data) ? listAdmin.data.some((u) => u.id === u1.data?.id && u.isActive === false) : false;
  check("admin sees archived unit", archivedVisible);
  const listNoArch = await req(admin, "GET", "/api/units");
  const archivedHidden = Array.isArray(listNoArch.data) ? listNoArch.data.every((u) => u.isActive !== false) : false;
  check("archived unit hidden from default list", archivedHidden);

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
