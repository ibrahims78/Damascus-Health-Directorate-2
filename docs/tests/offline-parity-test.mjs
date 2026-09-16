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
import crypto from "node:crypto";

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

// --------------------- deep-review regression guards ---------------------
// issuing more than the source warehouse holds must fail without writing anything
const balanceBefore = (await api("GET", "/reports/stock-by-warehouse")).data?.positions ?? [];
const overTransfer = await api("POST", "/transfers", { fromWarehouseId: centralId, toWarehouseId: branchId, items: [{ itemId, quantity: 999 }] });
const overIssue = await api("POST", `/transfers/${Number(overTransfer.data?.id)}/issue`, {});
check("guard: issuing more than the source holds is rejected (409 INSUFFICIENT_STOCK)", overIssue.status === 409 && overIssue.data?.code === "INSUFFICIENT_STOCK", `status=${overIssue.status}`);
const balanceAfter = (await api("GET", "/reports/stock-by-warehouse")).data?.positions ?? [];
check("guard: a rejected issue writes nothing", JSON.stringify(balanceBefore) === JSON.stringify(balanceAfter));

// an unknown item must be rejected before anything is persisted
const badItem = await api("POST", "/transfers", { fromWarehouseId: centralId, toWarehouseId: branchId, items: [{ itemId: 999999, quantity: 1 }] });
check("guard: unknown item in a transfer is rejected (400)", badItem.status === 400, `status=${badItem.status}`);

// an adjustment must keep the batch ledger honest
const adjust = await api("POST", "/transactions/adjust", { itemId, itemType: "item", newStock: 8, documentDate: today });
check("adjust: accepted", adjust.status === 201 || adjust.status === 200, `status=${adjust.status}`);
const reconAdjust = await api("GET", "/reports/reconciliation");
check("adjust: ledger still reconciles after an adjustment", Number(reconAdjust.data?.mismatches) === 0, `mismatches=${reconAdjust.data?.mismatches}`);
const totalAfterAdjust = ((await api("GET", "/reports/stock-by-warehouse")).data?.positions ?? []).reduce((sum, row) => sum + row.quantity, 0);
check("adjust: total quantity follows the new stock", totalAfterAdjust === 8, `total=${totalAfterAdjust}`);

// catalog import is journaled and can be rolled back on the device
await api("POST", "/catalog/import", { mode: "add-and-update", items: [{ code: "ROLL-1", name: "ROLL-1", unit: unitName }] });
const batchesList = (await api("GET", "/import-batches")).data ?? [];
const catalogBatch = batchesList.find((entry) => entry.kind === "catalog");
check("governance: catalog import is journaled", Boolean(catalogBatch), `rows=${batchesList.length}`);
check("governance: the journal records the created item keys", Array.isArray(catalogBatch?.createdItemKeys) && catalogBatch.createdItemKeys.includes("code:ROLL-1"));
const rollback = await api("POST", `/import-batches/${Number(catalogBatch?.id)}/rollback`, {});
check("governance: rollback reports the removed rows", rollback.status === 200 && Number(rollback.data?.removed) === 1, `removed=${rollback.data?.removed}`);
const afterRollback = await api("GET", "/items?limit=5000");
check("governance: rollback archives the imported item", !(afterRollback.data?.items ?? []).some((entry) => entry.code === "ROLL-1" && entry.isActive !== false));
// --------------------- audit P0/P1 on the device ---------------------
const countSession = await api("POST", "/counts", { blindCount: true });
const countId = Number(countSession.data?.id);
check("counts: session created on the device", countSession.status === 201 && Array.isArray(countSession.data?.lines), `lines=${countSession.data?.lines?.length}`);
const countLineP = (countSession.data?.lines ?? []).find((line) => Number(line.itemId) === itemId);
const incomplete = await api("POST", `/counts/${countId}/approve`, {});
check("counts: partial approval refused", incomplete.status === 409 && incomplete.data?.code === "COUNT_INCOMPLETE", `status=${incomplete.status}`);
await api("POST", `/counts/${countId}/entries`, { entries: [{ lineId: Number(countLineP?.id), countedQuantity: 7, varianceReason: "فرق جرد تجريبي" }] });
const countApproved = await api("POST", `/counts/${countId}/approve`, {});
check("counts: approval posts the difference", countApproved.status === 200 && Number(countApproved.data?.posted) >= 1, `posted=${countApproved.data?.posted}`);
const itemAfterCount = await api("GET", `/items/${itemId}`);
check("counts: stock matches the counted quantity", Number(itemAfterCount.data?.currentStock) === 7, `stock=${itemAfterCount.data?.currentStock}`);
const reconAfterCount = await api("GET", "/reports/reconciliation");
check("counts: ledger reconciles after the count", Number(reconAfterCount.data?.mismatches) === 0, `mismatches=${reconAfterCount.data?.mismatches}`);

const countTx = ((await api("GET", "/transactions?limit=50")).data?.transactions ?? []).find((t) => t.type === "adjust" && Number(t.itemId) === itemId);
const reversed = await api("POST", `/transactions/${Number(countTx?.id)}/reverse`, { reason: "عكس تسوية الجرد للاختبار" });
check("reversal: compensating document posted on the device", reversed.status === 200 && Boolean(reversed.data?.reversal?.id), `status=${reversed.status}`);
const itemAfterReversal = await api("GET", `/items/${itemId}`);
check("reversal: stock restored", Number(itemAfterReversal.data?.currentStock) === 8, `stock=${itemAfterReversal.data?.currentStock}`);
const twiceOnDevice = await api("POST", `/transactions/${Number(countTx?.id)}/reverse`, { reason: "محاولة ثانية للاختبار" });
check("reversal: a second reversal is refused", twiceOnDevice.status === 409, `status=${twiceOnDevice.status}`);

const reorderOnDevice = await api("GET", "/reports/reorder-suggestions");
check("reports: reorder suggestions respond on the device", reorderOnDevice.status === 200 && Array.isArray(reorderOnDevice.data?.items));
const kpiOnDevice = await api("GET", "/reports/kpi");
check("reports: KPI report responds on the device", kpiOnDevice.status === 200 && kpiOnDevice.data?.countSessions >= 1);
const abcOnDevice = await api("GET", "/reports/abc");
check("reports: ABC report responds on the device", abcOnDevice.status === 200 && Boolean(abcOnDevice.data?.counts));
const varianceOnDevice = await api("GET", "/reports/transfer-variance");
check("reports: transfer variance responds on the device", varianceOnDevice.status === 200 && typeof varianceOnDevice.data?.totalVariance === "number");
// --------------------- GRN on the device ---------------------
const stockBeforeGrn = Number((await api("GET", `/items/${itemId}`)).data?.currentStock ?? 0);
const draft = await api("POST", "/receipts", { supplierName: "مورد الجهاز", deliveryNoteNumber: "DGRN-1", lines: [{ itemId, orderedQuantity: 5, receivedQuantity: 4, rejectedQuantity: 1, rejectionReason: "تلف بالشحن", batchNumber: "DEV-GRN" }] });
check("GRN: draft created on the device", draft.status === 201 && Array.isArray(draft.data?.lines), `status=${draft.status}`);
const draftId = Number(draft.data?.id);
const stockAfterDraft = Number((await api("GET", `/items/${itemId}`)).data?.currentStock ?? 0);
check("GRN: a draft does not move stock on the device", stockAfterDraft === stockBeforeGrn, `stock=${stockAfterDraft}`);
const postedGrn = await api("POST", `/receipts/${draftId}/post`, {});
check("GRN: posting accepts the received quantity on the device", postedGrn.status === 200 && Number(postedGrn.data?.receivedTotal) === 4, `received=${postedGrn.data?.receivedTotal}`);
const stockAfterGrn = Number((await api("GET", `/items/${itemId}`)).data?.currentStock ?? 0);
check("GRN: only the accepted quantity entered stock", stockAfterGrn === stockBeforeGrn + 4, `stock=${stockAfterGrn}`);
check("GRN: rejected quantity recorded on the device", Number(postedGrn.data?.rejectedTotal) === 1, `rejected=${postedGrn.data?.rejectedTotal}`);
const reconAfterGrn = await api("GET", "/reports/reconciliation");
check("GRN: ledger reconciles after posting on the device", Number(reconAfterGrn.data?.mismatches) === 0, `mismatches=${reconAfterGrn.data?.mismatches}`);
const supplierOnDevice = await api("GET", "/receipts/summary");
check("GRN: supplier summary responds on the device", supplierOnDevice.status === 200 && Array.isArray(supplierOnDevice.data?.suppliers));
// --------------------- bins on the device ---------------------
const deviceBin = await api("POST", "/bins", { code: "DEV-B1", name: "رف الجهاز", zone: "A" });
check("bins: location created on the device", deviceBin.status === 201 && deviceBin.data?.code === "DEV-B1", `status=${deviceBin.status}`);
const deviceBinDup = await api("POST", "/bins", { code: "DEV-B1", name: "مكرر" });
check("bins: duplicate code refused on the device", deviceBinDup.status === 409, `status=${deviceBinDup.status}`);
const deviceBinList = await api("GET", "/bins");
check("bins: list responds on the device", Array.isArray(deviceBinList.data) && deviceBinList.data.some((row) => row.code === "DEV-B1"));
const deviceBinItem = await api("POST", "/items", { code: "DEV-BIN-ITEM", name: "صنف بموقع", unit: unitName, itemType: "item", binCode: "DEV-B1" });
check("bins: an item carries the code on the device", deviceBinItem.data?.binCode === "DEV-B1");
const deviceBinInUse = await api("DELETE", `/bins/${Number(deviceBin.data?.id)}`);
check("bins: in-use location cannot be archived on the device", deviceBinInUse.status === 409 && deviceBinInUse.data?.code === "BIN_IN_USE", `status=${deviceBinInUse.status}`);
const deviceBinUsage = await api("GET", "/bins/usage");
check("bins: usage responds on the device", (deviceBinUsage.data ?? []).some((row) => row.binCode === "DEV-B1" && row.known === true));
// --------------------- 2fa on the device ---------------------
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const decodeB32 = (input) => {
  let bits = 0; let value = 0; const out = [];
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const index = B32.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
};
const totpAt = (secret, seconds) => {
  const counter = Math.floor(seconds / 30);
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buffer.writeUInt32BE(counter % 0x100000000, 4);
  const digest = crypto.createHmac("sha1", decodeB32(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return String(binary % 1000000).padStart(6, "0");
};
const deviceSecret = (await api("POST", "/auth/2fa/setup", {})).data?.secret ?? "";
check("2fa: the device issues a secret", /^[A-Z2-7]{16,}$/.test(deviceSecret), `secret=${deviceSecret.slice(0, 6)}...`);
const badEnableDevice = await api("POST", "/auth/2fa/enable", { code: "000000" });
check("2fa: a wrong code cannot enable it on the device", badEnableDevice.status === 400, `status=${badEnableDevice.status}`);
const enableOnDevice = await api("POST", "/auth/2fa/enable", { code: totpAt(deviceSecret, Date.now() / 1000) });
check("2fa: enabling works on the device", enableOnDevice.status === 200 && enableOnDevice.data?.enabled === true, `status=${enableOnDevice.status}`);
await api("POST", "/auth/logout", {});
const deviceNoCode = await api("POST", "/auth/login", { username: "admin", password: "Admin@1234567" });
check("2fa: device login without a code is refused", deviceNoCode.status === 401 && deviceNoCode.data?.twoFactorRequired === true, `status=${deviceNoCode.status}`);
const deviceWithCode = await api("POST", "/auth/login", { username: "admin", password: "Admin@1234567", code: totpAt(deviceSecret, Date.now() / 1000) });
check("2fa: device login with the correct code succeeds", deviceWithCode.status === 200, `status=${deviceWithCode.status}`);
const disableOnDevice = await api("POST", "/auth/2fa/disable", { code: totpAt(deviceSecret, Date.now() / 1000) });
check("2fa: disabling works on the device", disableOnDevice.status === 200 && disableOnDevice.data?.enabled === false, `status=${disableOnDevice.status}`);
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
fs.writeFileSync(new URL("./.offline-parity/results.txt", import.meta.url), checks.map((c) => `${c.ok ? "PASS" : "FAIL"}  ${c.name}`).join("\n") + "\n", "utf8");
process.exit(failed.length ? 1 : 0);



