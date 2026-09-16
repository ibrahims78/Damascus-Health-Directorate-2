#!/usr/bin/env node
/**
 * Warehouse-practice audit features (P0/P1) integration test:
 * cycle counting, reversal documents, transfer variance, reorder suggestions,
 * KPI/ABC reports and the per-user warehouse scope.
 *
 * Run:  node docs/tests/warehouse-advanced-tests.mjs
 */
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const apiDir = path.join(root, "artifacts", "api-server");
const dataDir = path.join(root, "docs", "tests", ".advanced-run", `run-${Date.now()}`);
fs.mkdirSync(dataDir, { recursive: true });
const PORT = 41989;
const base = `http://127.0.0.1:${PORT}`;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
};
const jar = { cookie: "" };
async function req(method, p, body) {
  const res = await fetch(base + p, {
    method,
    headers: { "content-type": "application/json", ...(jar.cookie ? { cookie: jar.cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const sc = res.headers.getSetCookie?.() ?? [];
  if (sc.length) jar.cookie = sc.map((c) => c.split(";")[0]).join("; ");
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
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
  const until = Date.now() + 120000;
  let ready = false;
  while (Date.now() < until && !ready) {
    try { ready = (await fetch(`${base}/api/healthz`)).ok; } catch { /* retry */ }
    if (!ready) await new Promise((r) => setTimeout(r, 400));
  }
  if (!ready) throw new Error("API did not become ready");
  console.log("API ready\n");

  await req("POST", "/api/auth/setup", { username: "admin", password: "Admin@1234567", fullName: "مدير" });
  await req("POST", "/api/units/seed-defaults");
  const units = await req("GET", "/api/units");
  const unitName = Array.isArray(units.data) && units.data.length ? units.data[0].name : "قطعة";

  // two items with stock 10 and 5 at the central warehouse
  const itemA = await req("POST", "/api/items", { code: "CNT-A", name: "صنف الجرد أ", unit: unitName, itemType: "item", minStock: 4, reorderPoint: 6, maxStock: 20, safetyStock: 2, binCode: "A-01-1" });
  const itemB = await req("POST", "/api/items", { code: "CNT-B", name: "صنف الجرد ب", unit: unitName, itemType: "item", minStock: 1, reorderPoint: 10, maxStock: 30 });
  const idA = Number(itemA.data?.id);
  const idB = Number(itemB.data?.id);
  check("items: reorder/bin fields accepted", itemA.status === 201 && itemA.data?.reorderPoint === 6 && itemA.data?.binCode === "A-01-1", `status=${itemA.status}`);

  const today = new Date().toISOString().slice(0, 10);
  for (const [id, qty, batch] of [[idA, 10, "B-A"], [idB, 5, "B-B"]]) {
    await req("POST", "/api/transactions/in", {
      itemId: id, itemType: "item", quantity: qty, supplySource: "central_warehouses",
      deliveryNoteNumber: `DN-${batch}`, deliveryNoteDate: today, documentDate: today, batchNumber: batch,
    });
  }

  // ---------------- cycle counting ----------------
  const session = await req("POST", "/api/counts", { blindCount: true, notes: "جرد اختباري" });
  const sessionId = Number(session.data?.id);
  check("counts: session created with lines", session.status === 201 && Array.isArray(session.data?.lines) && session.data.lines.length >= 2, `lines=${session.data?.lines?.length}`);
  const lineA = (session.data?.lines ?? []).find((l) => Number(l.itemId) === idA);
  check("counts: snapshot carries the system quantity", Number(lineA?.systemQuantity) === 10, `qty=${lineA?.systemQuantity}`);

  const early = await req("POST", `/api/counts/${sessionId}/approve`, {});
  check("counts: approval refused while lines are uncounted", early.status === 409 && early.data?.code === "COUNT_INCOMPLETE", `status=${early.status}`);

  const lineB = (session.data?.lines ?? []).find((l) => Number(l.itemId) === idB);
  const entryA = await req("POST", `/api/counts/${sessionId}/entries`, { entries: [{ lineId: Number(lineA?.id), countedQuantity: 8 }] });
  check("counts: entry recorded", entryA.status === 200, `status=${entryA.status}`);
  await req("POST", `/api/counts/${sessionId}/entries`, { entries: [{ lineId: Number(lineB?.id), countedQuantity: 5, varianceReason: "" }] });
  const approveNoReason = await req("POST", `/api/counts/${sessionId}/approve`, {});
  check("counts: a variance without a reason is refused", approveNoReason.status === 409 && approveNoReason.data?.code === "COUNT_VARIANCE_REASON_REQUIRED", `status=${approveNoReason.status}`);
  await req("POST", `/api/counts/${sessionId}/entries`, { entries: [{ lineId: Number(lineA?.id), countedQuantity: 8, varianceReason: "تالف أثناء التخزين" }] });
  const approved = await req("POST", `/api/counts/${sessionId}/approve`, {});
  check("counts: approval posts the differences", approved.status === 200 && Number(approved.data?.posted) === 1, `posted=${approved.data?.posted}`);
  const afterA = await req("GET", `/api/items/${idA}`);
  check("counts: stock now matches the counted quantity", Number(afterA.data?.currentStock) === 8, `stock=${afterA.data?.currentStock}`);
  const detail = await req("GET", `/api/counts/${sessionId}`);
  check("counts: session is approved with variance totals", detail.data?.status === "approved" && Number(detail.data?.varianceLines) === 1 && Number(detail.data?.totalVariance) === -2, `variance=${detail.data?.totalVariance}`);
  const reconAfterCount = await req("GET", "/api/reports/reconciliation");
  check("counts: ledger still reconciles after the count", Number(reconAfterCount.data?.mismatches) === 0, `mismatches=${reconAfterCount.data?.mismatches}`);

  // ---------------- reversal ----------------
  const txs = await req("GET", "/api/transactions?limit=50");
  const countTx = (txs.data?.transactions ?? []).find((t) => t.type === "adjust" && Number(t.itemId) === idA);
  const reverse = await req("POST", `/api/transactions/${Number(countTx?.id)}/reverse`, { reason: "إلغاء تسوية الجرد لخطأ في العد" });
  check("reversal: compensating document posted", reverse.status === 200 && Boolean(reverse.data?.reversal?.id), `status=${reverse.status}`);
  const afterReverse = await req("GET", `/api/items/${idA}`);
  check("reversal: stock restored to the pre-count value", Number(afterReverse.data?.currentStock) === 10, `stock=${afterReverse.data?.currentStock}`);
  const twice = await req("POST", `/api/transactions/${Number(countTx?.id)}/reverse`, { reason: "محاولة عكس ثانية للاختبار" });
  check("reversal: a second reversal is rejected", twice.status === 409 && twice.data?.code === "ALREADY_REVERSED", `status=${twice.status}`);
  const shortReason = await req("POST", `/api/transactions/${Number(countTx?.id)}/reverse`, { reason: "خطأ" });
  check("reversal: short reasons are rejected", shortReason.status >= 400, `status=${shortReason.status}`);

  // ---------------- transfer variance ----------------
  const branch = await req("POST", "/api/warehouses", { code: "VB1", name: "فرع الفروق", type: "branch" });
  const branchId = Number(branch.data?.id);
  const transfer = await req("POST", "/api/transfers", { fromWarehouseId: 1, toWarehouseId: branchId, items: [{ itemId: idA, quantity: 5 }] });
  const transferId = Number(transfer.data?.id);
  await req("POST", `/api/transfers/${transferId}/issue`, {});
  const receiveLine = transfer.data?.lines?.[0];
  const receive = await req("POST", `/api/transfers/${transferId}/receive`, {
    deliveryNoteNumber: "VN-1",
    lines: [{ lineId: Number(receiveLine?.id), receivedQuantity: 4, varianceReason: "نقص في الشحنة" }],
  });
  check("transfers: receive accepts the counted quantity", receive.status === 200, `status=${receive.status}`);
  const varianceReport = await req("GET", "/api/reports/transfer-variance");
  const varianceRow = (varianceReport.data?.items ?? [])[0];
  check("transfers: variance is reported", varianceReport.status === 200 && Number(varianceRow?.variance) === -1, `variance=${varianceRow?.variance}`);

  // ---------------- reorder + KPI/ABC ----------------
  const reorder = await req("GET", "/api/reports/reorder-suggestions");
  const suggestion = (reorder.data?.items ?? []).find((row) => Number(row.id) === idB);
  check("reorder: item at/below its reorder point is suggested", reorder.status === 200 && Boolean(suggestion), `rows=${reorder.data?.count}`);
  check("reorder: suggested quantity fills up to the maximum", Number(suggestion?.suggestedQuantity) > 0, `suggest=${suggestion?.suggestedQuantity}`);
  const kpi = await req("GET", "/api/reports/kpi");
  check("kpi: report responds with the indicators", kpi.status === 200 && typeof kpi.data?.deadStockItems === "number" && kpi.data?.countAccuracy !== undefined, `accuracy=${kpi.data?.countAccuracy}`);
  const abc = await req("GET", "/api/reports/abc");
  check("abc: classification responds", abc.status === 200 && Boolean(abc.data?.counts), `A=${abc.data?.counts?.A}`);

  // ---------------- user scope ----------------
  const scoped = await req("POST", "/api/users", { username: "branchuser", password: "Branch@12345", fullName: "مستخدم فرع", role: "warehouse_manager", warehouseId: branchId });
  check("users: warehouse scope is stored", scoped.status === 201, `status=${scoped.status}`);

  // ---------------- goods receipt note (GRN) ----------------
  const draftNoReason = await req("POST", "/api/receipts", { supplierName: "مورد الاختبار", deliveryNoteNumber: "GDN-1", deliveryNoteDate: today, lines: [{ itemId: idA, orderedQuantity: 10, receivedQuantity: 8, rejectedQuantity: 2 }] });
  check("GRN: draft created with lines", draftNoReason.status === 201 && Array.isArray(draftNoReason.data?.lines), `status=${draftNoReason.status}`);
  const noReasonId = Number(draftNoReason.data?.id);
  const postNoReason = await req("POST", `/api/receipts/${noReasonId}/post`, {});
  check("GRN: rejection without a reason is refused", postNoReason.status === 409 && postNoReason.data?.code === "RECEIPT_REJECTION_REASON_REQUIRED", `status=${postNoReason.status}`);
  await req("POST", `/api/receipts/${noReasonId}/cancel`, {});
  const cancelledPost = await req("POST", `/api/receipts/${noReasonId}/post`, {});
  check("GRN: a cancelled receipt cannot be posted", cancelledPost.status === 409, `status=${cancelledPost.status}`);

  const beforeGrn = await req("GET", `/api/items/${idA}`);
  const stockBefore = Number(beforeGrn.data?.currentStock ?? 0);
  const draft = await req("POST", "/api/receipts", { supplierName: "مورد الاختبار", deliveryNoteNumber: "GDN-2", deliveryNoteDate: today, referenceNumber: "PO-77", lines: [
    { itemId: idA, orderedQuantity: 10, receivedQuantity: 8, rejectedQuantity: 2, rejectionReason: "عبوة تالفة", batchNumber: "GRN-B-1", expiryDate: "2027-06-30" },
  ] });
  const draftId = Number(draft.data?.id);
  const beforePost = await req("GET", `/api/items/${idA}`);
  check("GRN: draft does not touch stock", Number(beforePost.data?.currentStock) === stockBefore, `stock=${beforePost.data?.currentStock}`);
  const posted = await req("POST", `/api/receipts/${draftId}/post`, {});
  check("GRN: posting accepts the received quantity", posted.status === 200 && Number(posted.data?.receivedTotal) === 8, `received=${posted.data?.receivedTotal}`);
  check("GRN: rejected quantity is recorded, not stocked", Number(posted.data?.rejectedTotal) === 2, `rejected=${posted.data?.rejectedTotal}`);
  const afterPost = await req("GET", `/api/items/${idA}`);
  check("GRN: stock grew by the accepted quantity only", Number(afterPost.data?.currentStock) === stockBefore + 8, `stock=${afterPost.data?.currentStock}`);
  const reconAfterGrn = await req("GET", "/api/reports/reconciliation");
  check("GRN: ledger reconciles after posting", Number(reconAfterGrn.data?.mismatches) === 0, `mismatches=${reconAfterGrn.data?.mismatches}`);
  const twice2 = await req("POST", `/api/receipts/${draftId}/post`, {});
  check("GRN: a posted receipt cannot be posted twice", twice2.status === 409, `status=${twice2.status}`);
  const supplierSummary = await req("GET", "/api/receipts/summary");
  const supplierRow = (supplierSummary.data?.suppliers ?? []).find((row) => row.supplierName === "مورد الاختبار");
  check("GRN: supplier performance is reported", Boolean(supplierRow) && Number(supplierRow?.rejected) === 2, `rejected=${supplierRow?.rejected}`);
  // ---------------- external alert notifications (webhook) ----------------
  const hookPayloads = [];
  const hookServer = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => { hookPayloads.push(body); response.writeHead(200); response.end("ok"); });
  });
  await new Promise((resolve) => hookServer.listen(0, "127.0.0.1", resolve));
  const hookPort = hookServer.address().port;
  const hookUrl = `http://127.0.0.1:${hookPort}/hooks/alerts`;

  const savedHook = await req("PUT", "/api/settings", { alertWebhookUrl: hookUrl });
  check("webhook: the url is stored in the settings", savedHook.status === 200, `status=${savedHook.status}`);
  const badHook = await req("PUT", "/api/settings", { alertWebhookUrl: "not-a-url" });
  check("webhook: an invalid url is rejected", badHook.status === 400, `status=${badHook.status}`);
  const settingsNow = await req("GET", "/api/settings");
  check("webhook: the settings endpoint exposes it", settingsNow.data?.alertWebhookUrl === hookUrl, `value=${settingsNow.data?.alertWebhookUrl}`);

  // an item below its minimum makes the worker raise a critical alert
  const lowItem = await req("POST", "/api/items", { code: "HOOK-1", name: "صنف تنبيه", unit: unitName, itemType: "item", minStock: 10 });
  check("webhook: probe item created", lowItem.status === 201, `status=${lowItem.status}`);
  await req("POST", "/api/alerts/refresh", {});
  for (let attempt = 0; attempt < 24 && hookPayloads.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  check("webhook: the alert payload was delivered", hookPayloads.length > 0, `payloads=${hookPayloads.length}`);
  let parsedHook = null;
  try { parsedHook = JSON.parse(hookPayloads[0] ?? "{}"); } catch { parsedHook = null; }
  check("webhook: payload carries the alert list", Array.isArray(parsedHook?.alerts) && parsedHook.alerts.length > 0, `alerts=${parsedHook?.alerts?.length}`);
  check("webhook: payload identifies the source", parsedHook?.source === "damascus-health-directorate");

  await req("PUT", "/api/settings", { alertWebhookUrl: null });
  hookServer.close();
  // ---------------- storage locations (bins) ----------------
  const bin = await req("POST", "/api/bins", { code: "B-01-1", name: "رف 1", zone: "A" });
  check("bins: location created", bin.status === 201, `status=${bin.status}`);
  const dupBin = await req("POST", "/api/bins", { code: "B-01-1", name: "مكرر" });
  check("bins: duplicate code is rejected", dupBin.status === 409 && dupBin.data?.code === "BIN_CODE_DUPLICATE", `status=${dupBin.status}`);
  const binList = await req("GET", "/api/bins");
  check("bins: list responds", Array.isArray(binList.data) && binList.data.some((row) => row.code === "B-01-1"), `rows=${binList.data?.length}`);
  const binItem = await req("POST", "/api/items", { code: "BIN-1", name: "صنف موقع", unit: unitName, itemType: "item", binCode: "B-01-1" });
  check("bins: an item can carry the location code", binItem.status === 201 && binItem.data?.binCode === "B-01-1", `binCode=${binItem.data?.binCode}`);
  const binUsage = await req("GET", "/api/bins/usage");
  check("bins: usage reports known codes", (binUsage.data ?? []).some((row) => row.binCode === "B-01-1" && row.known === true && Number(row.items) >= 1), `rows=${binUsage.data?.length}`);
  const binInUse = await req("DELETE", `/api/bins/${Number(bin.data?.id)}`);
  check("bins: archiving an in-use location is refused", binInUse.status === 409 && binInUse.data?.code === "BIN_IN_USE", `status=${binInUse.status}`);
  const freeBin = await req("POST", "/api/bins", { code: "B-99-9", name: "رف فارغ" });
  const freeArchive = await req("DELETE", `/api/bins/${Number(freeBin.data?.id)}`);
  check("bins: an unused location is archived", freeArchive.status === 200 && freeArchive.data?.isActive === false, `status=${freeArchive.status}`);
  // ---------------- print detail: one movement drawn from two batches ----------------
  const createdRecipient = await req("POST", "/api/recipients", { name: "جهة اختبار الطباعة" });
  const recipients = await req("GET", "/api/recipients");
  const exitReasons = await req("GET", "/api/exit-reasons");
  const recipientId = Number(createdRecipient.data?.id ?? (recipients.data ?? [])[0]?.id ?? 0);
  const exitReasonId = Number((exitReasons.data ?? [])[0]?.id ?? 0);
  const multiItem = await req("POST", "/api/items", { code: "MULTI-1", name: "صنف بدفعتين", unit: unitName, itemType: "item", minStock: 0 });
  const multiId = Number(multiItem.data?.id);
  await req("POST", "/api/transactions/in", { itemId: multiId, itemType: "item", quantity: 600, supplySource: "central_warehouses", deliveryNoteNumber: "DN-LOT-A", deliveryNoteDate: today, documentDate: today, batchNumber: "LOT-A", expiryDate: "2027-03-31" });
  await req("POST", "/api/transactions/in", { itemId: multiId, itemType: "item", quantity: 100, supplySource: "central_warehouses", deliveryNoteNumber: "DN-LOT-B", deliveryNoteDate: today, documentDate: today, batchNumber: "LOT-B", expiryDate: "2026-12-31" });
  const issue = await req("POST", "/api/transactions/out", { itemId: multiId, itemType: "item", quantity: 700, recipientId, exitReasonId, documentDate: today, internalDeliveryNoteNumber: "IDN-MULTI-1", internalDeliveryNoteDate: today, deliveryDestination: "administrative_building" });
  check("print: a 700-unit issue across two batches is accepted", issue.status === 201, `status=${issue.status}`);
  const printData = await req("GET", `/api/transactions/${Number(issue.data?.id)}/print`);
  const allocations = printData.data?.allocations ?? [];
  check("print: the document exposes the batch breakdown", Array.isArray(allocations) && allocations.length === 2, `rows=${allocations.length}`);
  const batchNumbers = allocations.map((row) => row.batchNumber);
  check("print: it names both batches", batchNumbers.includes("LOT-A") && batchNumbers.includes("LOT-B"), `batches=${batchNumbers.join(",")}`);
  check("print: it carries each expiry date", allocations.some((row) => row.batchNumber === "LOT-A" && String(row.expiryDate).startsWith("2027-03-31")) && allocations.some((row) => row.batchNumber === "LOT-B" && String(row.expiryDate).startsWith("2026-12-31")));
  check("print: the breakdown follows FEFO (earliest expiry consumed first)", allocations[0]?.batchNumber === "LOT-B" && Number(allocations[0]?.quantity) === 100, `first=${allocations[0]?.batchNumber}:${allocations[0]?.quantity}`);
  check("print: the batches sum to the issued quantity", allocations.reduce((sum, row) => sum + Number(row.quantity ?? 0), 0) === 700, `sum=${allocations.reduce((sum, row) => sum + Number(row.quantity ?? 0), 0)}`);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  fs.writeFileSync(path.join(root, "docs", "tests", ".advanced-run", "results.txt"), results.map((r) => `${r.ok ? "PASS" : "FAIL"}  ${r.name}`).join("\n") + "\n", "utf8");
  exitCode = failed.length ? 1 : 0;
} catch (error) {
  console.error("TEST RUN FAILED:", error);
  exitCode = 1;
} finally {
  child.kill();
  await new Promise((r) => setTimeout(r, 700));
}
process.exit(exitCode);


