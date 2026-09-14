#!/usr/bin/env node
/**
 * Phase 6 — inter-warehouse transfer cycle integration test.
 *
 * Asserts:
 *   - a transfer request is created with a warehouse-prefixed code
 *   - issue moves stock out of the source warehouse (locally and immediately)
 *   - receive moves stock into the target warehouse (new batch there)
 *   - per-warehouse stock reflects both sides
 *   - invalid transitions are rejected (receive before issue, issue after reject)
 *   - a provisional receipt is accepted before the issue document arrives
 *
 * Run:  node docs/tests/phase6-transfer-tests.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const apiDir = path.join(root, "artifacts", "api-server");
const dataDir = path.join(root, "docs", "tests", ".phase6-run", `run-${Date.now()}`);
fs.mkdirSync(dataDir, { recursive: true });
const PORT = 41992;
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

  const warehouses = (await req(admin, "GET", "/api/warehouses")).data;
  const central = warehouses.find((w) => w.type === "central");
  const branch = (await req(admin, "POST", "/api/warehouses", { code: "S01", name: "فرع S01", type: "branch" })).data;
  check("branch warehouse created", Boolean(branch?.id), `id=${branch?.id}`);

  // stock at the central warehouse
  const item = (await req(admin, "POST", "/api/items", { code: "TRF-1", name: "مادة تحويل", itemType: "consumable", unit: "قطعة" })).data;
  const inTx = await req(admin, "POST", "/api/transactions/in", {
    itemId: item.id, itemType: "item", quantity: 20, supplySource: "central_warehouses",
    deliveryNoteNumber: "DN-C-1", deliveryNoteDate: "2026-09-14", documentDate: "2026-09-14",
  });
  check("central warehouse received 20 units", inTx.status >= 200 && inTx.status < 300, `status=${inTx.status}`);

  const stockBefore = (await req(admin, "GET", "/api/reports/stock-by-warehouse")).data;
  const atCentralBefore = (stockBefore?.positions ?? []).find((p) => p.itemId === item.id && p.warehouseId === central.id)?.quantity;
  check("stock-by-warehouse shows the central balance", atCentralBefore === 20, `qty=${atCentralBefore}`);

  // ---- request -> issue -> receive ---------------------------------------
  const created = await req(admin, "POST", "/api/transfers", {
    fromWarehouseId: central.id, toWarehouseId: branch.id,
    items: [{ itemId: item.id, quantity: 5, batchNumber: "TB-1", expiryDate: "2027-06-30" }],
  });
  check("transfer request created (201)", created.status === 201, `status=${created.status}`);
  check("transfer code is warehouse-prefixed", /^C-TRF-\d{4}-\d{6}$/.test(String(created.data?.code)), `code=${created.data?.code}`);
  check("transfer starts as requested", created.data?.status === "requested", `status=${created.data?.status}`);
  const transferId = created.data?.id;

  const premature = await req(admin, "POST", `/api/transfers/${transferId}/receive`, {});
  check("cannot receive before issue (409)", premature.status === 409, `status=${premature.status}`);

  const issued = await req(admin, "POST", `/api/transfers/${transferId}/issue`);
  check("transfer issued (200)", issued.status === 200 && issued.data?.status === "issued", `status=${issued.data?.status}`);

  const itemAfterIssue = (await req(admin, "GET", `/api/items/${item.id}`)).data;
  check("source balance decreased immediately (-5)", Number(itemAfterIssue?.currentStock) === 15, `stock=${itemAfterIssue?.currentStock}`);

  const received = await req(admin, "POST", `/api/transfers/${transferId}/receive`, { deliveryNoteNumber: "DN-TRF-1" });
  check("transfer received (200)", received.status === 200 && received.data?.status === "received", `status=${received.data?.status}`);

  const itemAfterReceive = (await req(admin, "GET", `/api/items/${item.id}`)).data;
  check("global balance restored after receipt (20)", Number(itemAfterReceive?.currentStock) === 20, `stock=${itemAfterReceive?.currentStock}`);

  const stockAfter = (await req(admin, "GET", "/api/reports/stock-by-warehouse")).data;
  const centralQty = (stockAfter?.positions ?? []).find((p) => p.itemId === item.id && p.warehouseId === central.id)?.quantity;
  const branchQty = (stockAfter?.positions ?? []).find((p) => p.itemId === item.id && p.warehouseId === branch.id)?.quantity;
  check("central holds the reduced balance (15)", centralQty === 15, `qty=${centralQty}`);
  check("branch holds the received balance (5)", branchQty === 5, `qty=${branchQty}`);

  // ---- reject + invalid transition ---------------------------------------
  const second = await req(admin, "POST", "/api/transfers", {
    fromWarehouseId: central.id, toWarehouseId: branch.id, items: [{ itemId: item.id, quantity: 1 }],
  });
  const rejected = await req(admin, "POST", `/api/transfers/${second.data?.id}/reject`, { reason: "غير مطلوب حاليًا" });
  check("transfer rejected (200)", rejected.status === 200 && rejected.data?.status === "rejected", `status=${rejected.data?.status}`);
  const issueRejected = await req(admin, "POST", `/api/transfers/${second.data?.id}/issue`);
  check("cannot issue a rejected transfer (409)", issueRejected.status === 409, `status=${issueRejected.status}`);

  // ---- provisional receipt ------------------------------------------------
  const third = await req(admin, "POST", "/api/transfers", {
    fromWarehouseId: central.id, toWarehouseId: branch.id, items: [{ itemId: item.id, quantity: 2, batchNumber: "TB-2", expiryDate: "2027-07-31" }],
  });
  const provisional = await req(admin, "POST", `/api/transfers/${third.data?.id}/receive`, { provisional: true, deliveryNoteNumber: "DN-PAPER-9" });
  check("provisional receipt accepted (200)", provisional.status === 200 && provisional.data?.status === "received", `status=${provisional.data?.status}`);
  check("provisional flag recorded", provisional.data?.provisional === true, `provisional=${provisional.data?.provisional}`);

  // ---- permissions --------------------------------------------------------
  check("warehouse_manager can request a transfer (201)", (await req(wh, "POST", "/api/transfers", { toWarehouseId: branch.id, items: [{ itemId: item.id, quantity: 1 }] })).status === 201);
  check("unauthenticated cannot list transfers (401)", (await req(makeJar(), "GET", "/api/transfers")).status === 401);

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
