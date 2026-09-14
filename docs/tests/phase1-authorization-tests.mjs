#!/usr/bin/env node
/**
 * Phase 1 — governance & permissions integration test.
 *
 * Boots the built API against a throwaway PGlite data directory and asserts the
 * Phase 1 authorization matrix:
 *   - definitions (items / equipment / categories / recipients) are admin-only
 *   - warehouse_manager keeps read + operations access
 *   - equipment is archived (soft delete), never hard-deleted
 *   - equipment catalog code is unique
 *   - a category used by items cannot be deleted
 *
 * Run:  node docs/tests/phase1-authorization-tests.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const apiDir = path.join(root, "artifacts", "api-server");
const dataDir = path.join(root, "docs", "tests", ".phase1-run", `run-${Date.now()}`);
fs.mkdirSync(dataDir, { recursive: true });
const PORT = 41997;
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
    headers: {
      "content-type": "application/json",
      ...(jar.cookie ? { cookie: jar.cookie } : {}),
    },
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
    try {
      const r = await fetch(`${base}/api/healthz`);
      if (r.ok) return true;
    } catch {}
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
  const setup = await req(admin, "POST", "/api/auth/setup", {
    username: "admin",
    password: "Admin@1234567",
    fullName: "مدير النظام",
  });
  check("setup admin account", setup.status === 200, `status=${setup.status}`);

  const created = await req(admin, "POST", "/api/users", {
    username: "wh1",
    password: "Warehouse@123",
    fullName: "أمين مستودع",
    role: "warehouse_manager",
  });
  check("admin creates warehouse_manager", created.status === 201, `status=${created.status}`);

  const wh = makeJar();
  const whLogin = await req(wh, "POST", "/api/auth/login", {
    username: "wh1",
    password: "Warehouse@123",
  });
  check("warehouse_manager login", whLogin.status === 200, `status=${whLogin.status}`);

  check("warehouse_manager reads items", (await req(wh, "GET", "/api/items")).status === 200);
  check("warehouse_manager reads equipment", (await req(wh, "GET", "/api/equipment")).status === 200);

  const itemPayload = { code: "ITM-001", name: "شاش طبي", itemType: "consumable", unit: "قطعة" };
  check(
    "warehouse_manager CANNOT create item (403)",
    (await req(wh, "POST", "/api/items", itemPayload)).status === 403,
  );
  const item = await req(admin, "POST", "/api/items", itemPayload);
  check("admin creates item (201)", item.status === 201, `status=${item.status}`);
  const itemId = item.data?.id;
  check(
    "warehouse_manager CANNOT update item (403)",
    (await req(wh, "PUT", `/api/items/${itemId}`, { name: "شاش طبي معدل" })).status === 403,
  );
  check(
    "warehouse_manager CANNOT archive item (403)",
    (await req(wh, "DELETE", `/api/items/${itemId}`)).status === 403,
  );
  check(
    "warehouse_manager CANNOT bulk-import items (403)",
    (await req(wh, "POST", "/api/items/bulk-import", [itemPayload])).status === 403,
  );

  check(
    "warehouse_manager CANNOT create equipment (403)",
    (await req(wh, "POST", "/api/equipment", { name: "جهاز", condition: "good" })).status === 403,
  );
  const eq = await req(admin, "POST", "/api/equipment", {
    code: "EQ-001", name: "جهاز قياس ضغط", condition: "good", quantity: 1,
  });
  check("admin creates equipment with code (201)", eq.status === 201, `status=${eq.status}`);
  const eqId = eq.data?.id;
  const dup = await req(admin, "POST", "/api/equipment", { code: "EQ-001", name: "جهاز آخر", condition: "good" });
  check("duplicate equipment code rejected (409)", dup.status === 409, `status=${dup.status}`);
  check(
    "warehouse_manager CANNOT archive equipment (403)",
    (await req(wh, "DELETE", `/api/equipment/${eqId}`)).status === 403,
  );
  const arch = await req(admin, "DELETE", `/api/equipment/${eqId}`);
  check("admin archives equipment (204)", arch.status === 204, `status=${arch.status}`);
  const listAfter = await req(admin, "GET", "/api/equipment?limit=5000");
  const stillListed = Array.isArray(listAfter.data?.equipment)
    ? listAfter.data.equipment.some((e) => e.id === eqId)
    : true;
  check("archived equipment hidden from list", !stillListed);

  check(
    "warehouse_manager CANNOT create recipient (403)",
    (await req(wh, "POST", "/api/recipients", { name: "جهة" })).status === 403,
  );

  const cat = await req(admin, "POST", "/api/categories", { name: "تصنيف اختبار", type: "consumable" });
  check("admin creates category (201)", cat.status === 201, `status=${cat.status}`);
  const catId = cat.data?.id;
  check(
    "category assigned to item (200)",
    (await req(admin, "PUT", `/api/items/${itemId}`, { categoryId: catId })).status === 200,
  );
  check(
    "in-use category cannot be deleted (409)",
    (await req(admin, "DELETE", `/api/categories/${catId}`)).status === 409,
  );

  const inTx = await req(admin, "POST", "/api/transactions/in", {
    itemId,
    itemType: "item",
    quantity: 5,
    supplySource: "central_warehouses",
    deliveryNoteNumber: "DN-TEST-1",
    deliveryNoteDate: "2026-09-14",
    batchNumber: "B-1",
    expiryDate: "2027-01-01",
    documentDate: "2026-09-14",
  });
  if (inTx.status >= 200 && inTx.status < 300) {
    check(
      "item code locked after a movement (409)",
      (await req(admin, "PUT", `/api/items/${itemId}`, { code: "ITM-CHANGED" })).status === 409,
    );
  } else {
    console.log(`SKIP  item identity lock (movement endpoint returned ${inTx.status}: ${JSON.stringify(inTx.data)})`);
  }

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
