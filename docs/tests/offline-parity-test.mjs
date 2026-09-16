#!/usr/bin/env node
/**
 * Offline-layer parity test.
 *
 * Boots the on-device API (artifacts/web/src/lib/offline-api.ts, bundled) inside
 * Node with an in-memory IndexedDB shim, then exercises the endpoints that used
 * to exist on the server only: units, warehouses, the transfer cycle, import
 * governance, the sync overview, the newer reports and the items export.
 */
import fs from "node:fs";

// ------------------------------- shims -------------------------------
const store = new Map();
const makeRequest = () => ({ onsuccess: null, onerror: null, onupgradeneeded: null, result: undefined, error: null });

class FakeTransaction {
  constructor() {
    this.oncomplete = null;
    this.onerror = null;
    this.onabort = null;
    this._done = false;
  }
  objectStore() {
    return {
      get: (key) => {
        const req = makeRequest();
        Promise.resolve().then(() => {
          req.result = store.get(key);
          req.onsuccess?.({ target: req });
          this._complete();
        });
        return req;
      },
      put: (value, key) => {
        const req = makeRequest();
        Promise.resolve().then(() => {
          store.set(key, value);
          req.onsuccess?.({ target: req });
          this._complete();
        });
        return req;
      },
    };
  }
  abort() {
    this.onabort?.();
  }
  _complete() {
    if (this._done) return;
    this._done = true;
    Promise.resolve().then(() => this.oncomplete?.());
  }
}

const fakeDb = {
  objectStoreNames: { contains: () => true },
  createObjectStore() {},
  transaction() {
    return new FakeTransaction();
  },
  close() {},
};

globalThis.indexedDB = {
  open() {
    const req = makeRequest();
    Promise.resolve().then(() => {
      req.result = fakeDb;
      req.onupgradeneeded?.({ target: req });
      req.onsuccess?.({ target: req });
    });
    return req;
  },
};

const localStore = new Map();
globalThis.window = globalThis;
globalThis.localStorage = {
  getItem: (k) => (localStore.has(k) ? localStore.get(k) : null),
  setItem: (k, v) => localStore.set(k, String(v)),
  removeItem: (k) => localStore.delete(k),
};
globalThis.location = { origin: "http://localhost" };
Object.defineProperty(globalThis, "navigator", { value: { userAgent: "Node" }, configurable: true });
globalThis.document = { createElement: () => ({ click() {}, style: {} }), body: { appendChild() {} } };
globalThis.URL.createObjectURL ??= () => "blob:test";
globalThis.URL.revokeObjectURL ??= () => {};

const { installOfflineApi } = await import("./.offline-parity/offline-api.bundle.mjs");
installOfflineApi();

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
};

let cookie = "";
async function api(method, path, body) {
  const res = await fetch(`http://localhost/api${path}`, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

const today = new Date().toISOString().slice(0, 10);

// ------------------------------- run ---------------------------------
await api("POST", "/auth/setup", { username: "admin", password: "Admin@1234567", fullName: "Ù…Ø¯ÙŠØ±" });

// units
const seeded = await api("POST", "/units/seed-defaults");
check("units: seed-defaults creates the standard units", seeded.status === 200 && Number(seeded.data?.created) > 0, `created=${seeded.data?.created}`);
const unitList = await api("GET", "/units");
const unitName = Array.isArray(unitList.data) && unitList.data.length ? unitList.data[0].name : null;
check("units: list returns the catalog", Array.isArray(unitList.data) && unitList.data.length > 0, `first=${unitName}`);
check("units: units carry the UI fields", Boolean(unitList.data?.[0] && "isSystem" in unitList.data[0] && "sortOrder" in unitList.data[0]));
const dupUnit = await api("POST", "/units", { name: unitName });
check("units: duplicate name is rejected (409)", dupUnit.status === 409 && dupUnit.data?.code === "UNIT_NAME_DUPLICATE", `status=${dupUnit.status}`);
const usage = await api("GET", "/units/usage");
check("units: usage returns rows", Array.isArray(usage.data), `rows=${usage.data?.length}`);

// warehouses
const whList = await api("GET", "/warehouses");
check("warehouses: a central warehouse exists out of the box", Array.isArray(whList.data) && whList.data.some((w) => w.type === "central" && w.code === "C"), `count=${whList.data?.length}`);
const branch = await api("POST", "/warehouses", { code: "B1", name: "Ù…Ø³ØªÙˆØ¯Ø¹ Ø§Ù„ÙØ±Ø¹", type: "branch" });
check("warehouses: create branch (201)", branch.status === 201 && branch.data?.code === "B1", `status=${branch.status}`);
const dupWh = await api("POST", "/warehouses", { code: "B1", name: "Ù…ÙƒØ±Ø±" });
check("warehouses: duplicate code rejected (409)", dupWh.status === 409 && dupWh.data?.code === "WAREHOUSE_CODE_DUPLICATE", `status=${dupWh.status}`);
const branchId = Number(branch.data?.id);
const switched = await api("POST", "/warehouses/current", { id: branchId });
check("warehouses: switch current warehouse", switched.status === 200 && switched.data?.code === "B1", `status=${switched.status}`);
const docNumber = await api("GET", "/warehouses/next-document-number?type=in");
const year = new Date().getFullYear();
check("warehouses: document numbering CODE-TYPE-YEAR-NNNNNN", docNumber.data?.documentNumber === `B1-IN-${year}-000001`, `value=${docNumber.data?.documentNumber}`);
const centralList = await api("GET", "/warehouses");
const centralId = Number(centralList.data.find((w) => w.code === "C")?.id);
await api("POST", "/warehouses/current", { id: centralId });

// item + stock at the central warehouse
const item = await api("POST", "/items", { code: "P-1", name: "ØµÙ†Ù Ø§Ø®ØªØ¨Ø§Ø±", unit: unitName, itemType: "item", minStock: 5 });
const itemId = Number(item.data?.id);
check("items: create works on the device", Boolean(itemId), `id=${itemId}`);
const moveIn = await api("POST", "/transactions/in", {
  itemId, itemType: "item", quantity: 10, supplySource: "central_warehouses",
  deliveryNoteNumber: "DN-1", deliveryNoteDate: today, documentDate: today,
  batchNumber: "B-1", expiryDate: "2027-01-01",
});
check("transactions: inbound movement works on the device", moveIn.status === 201, `status=${moveIn.status}`);

// reports
const recon = await api("GET", "/reports/reconciliation");
check("reports: reconciliation responds", recon.status === 200 && typeof recon.data?.mismatches === "number", `mismatches=${recon.data?.mismatches}`);
check("reports: reconciliation agrees with the batch ledger", Number(recon.data?.mismatches) === 0, `mismatches=${recon.data?.mismatches}`);
const byWh = await api("GET", "/reports/stock-by-warehouse");
check("reports: stock-by-warehouse lists positions", byWh.status === 200 && Array.isArray(byWh.data?.positions) && byWh.data.positions.length === 1, `positions=${byWh.data?.positions?.length}`);
check("reports: stock-by-warehouse carries warehouse + item", byWh.data?.positions?.[0]?.warehouse?.code === "C" && byWh.data?.positions?.[0]?.item?.name === "ØµÙ†Ù Ø§Ø®ØªØ¨Ø§Ø±");
const consolidated = await api("GET", "/reports/consolidated");
check("reports: consolidated totals", consolidated.status === 200 && Number(consolidated.data?.totals?.quantity) === 10, `quantity=${consolidated.data?.totals?.quantity}`);

// transfers
const created = await api("POST", "/transfers", { fromWarehouseId: centralId, toWarehouseId: branchId, items: [{ itemId, quantity: 4 }], notes: "Ø§Ø®ØªØ¨Ø§Ø±" });
const transferId = Number(created.data?.id);
check("transfers: request created (201)", created.status === 201 && created.data?.status === "requested", `code=${created.data?.code}`);
check("transfers: code is numbered per warehouse", typeof created.data?.code === "string" && created.data.code.startsWith("C-TRF-"), `code=${created.data?.code}`);
check("transfers: lines carry the item", created.data?.lines?.[0]?.item?.name === "ØµÙ†Ù Ø§Ø®ØªØ¨Ø§Ø±");
const badTransition = await api("POST", `/transfers/${transferId}/receive`, {});
check("transfers: cannot receive before issue (409)", badTransition.status === 409 && badTransition.data?.code === "INVALID_TRANSITION", `status=${badTransition.status}`);
const issued = await api("POST", `/transfers/${transferId}/issue`, {});
check("transfers: issue moves the stock out", issued.status === 200 && issued.data?.status === "issued", `status=${issued.data?.status}`);
const afterIssue = await api("GET", `/reports/stock-by-warehouse`);
const centralQty = Number(afterIssue.data?.positions?.find((p) => p.warehouse?.code === "C")?.quantity);
check("transfers: central balance dropped to 6", centralQty === 6, `central=${centralQty}`);
const received = await api("POST", `/transfers/${transferId}/receive`, { deliveryNoteNumber: "TRF-IN-1" });
check("transfers: receive closes the cycle", received.status === 200 && ["received", "closed"].includes(received.data?.status), `status=${received.data?.status}`);
const afterReceive = await api("GET", "/reports/stock-by-warehouse");
const positions = afterReceive.data?.positions ?? [];
check("transfers: destination warehouse now holds the goods", positions.some((p) => p.warehouse?.code === "B1" && p.quantity === 4), `positions=${positions.map((p) => `${p.warehouse?.code}:${p.quantity}`).join(",")}`);
const reconAfter = await api("GET", "/reports/reconciliation");
check("transfers: ledger still reconciles", Number(reconAfter.data?.mismatches) === 0, `mismatches=${reconAfter.data?.mismatches}`);
const list = await api("GET", "/transfers?limit=200");
check("transfers: list returns the transfer", Array.isArray(list.data) && list.data.length === 1, `rows=${list.data?.length}`);
const detail = await api("GET", `/transfers/${transferId}`);
check("transfers: detail includes lines", Array.isArray(detail.data?.lines) && detail.data.lines.length === 1);

// import governance + sync + export
const batches = await api("GET", "/import-batches");
check("import governance: list responds", batches.status === 200 && Array.isArray(batches.data), `rows=${batches.data?.length}`);
const rollbackMissing = await api("POST", "/import-batches/999/rollback");
check("import governance: rollback on unknown batch (404)", rollbackMissing.status === 404, `status=${rollbackMissing.status}`);
const overview = await api("GET", "/sync/overview");
check("sync: overview responds with node + counters", overview.status === 200 && Boolean(overview.data?.node?.nodeId) && typeof overview.data?.outbox?.pending === "number", `node=${String(overview.data?.node?.nodeId).slice(0, 8)}`);
check("sync: overview names the current warehouse", overview.data?.warehouse?.code === "C");
const exported = await api("GET", "/items/export");
check("export: items export responds", exported.status === 200 && exported.data?.version === "4.0", `version=${exported.data?.version}`);
check("export: export carries items + batches", exported.data?.items?.length === 1 && exported.data?.openingBatches?.length === 2, `items=${exported.data?.items?.length} batches=${exported.data?.openingBatches?.length}`);

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
fs.writeFileSync(new URL("./.offline-parity/results.txt", import.meta.url), checks.map((c) => `${c.ok ? "PASS" : "FAIL"}  ${c.name}`).join("\n") + "\n", "utf8");
process.exit(failed.length ? 1 : 0);



