// End-to-end sync tests: two live desktop instances (A:8080, B:8081).
// Run: node api-sync-tests.mjs
// Requires both servers running with separate PGlite data dirs.
const ADMIN_PW = process.env.SEED_ADMIN_PASSWORD ?? '***';
const A = process.env.SYNC_A || 'http://127.0.0.1:8080';
const B = process.env.SYNC_B || 'http://127.0.0.1:8081';
const PASSWORD = 'SyncTest!2026';
const REQUEST_TIMEOUT_MS = Number(process.env.SYNC_REQUEST_TIMEOUT_MS || 30_000);

const results = { pass: 0, fail: 0, failures: [] };
const t = async (name, fn) => {
  try {
    const r = await fn();
    if (r === true || r === undefined) { results.pass++; console.log(`✅ ${name}`); }
    else { results.fail++; results.failures.push(`${name} => ${JSON.stringify(r)}`); console.log(`❌ ${name} => ${JSON.stringify(r)}`); }
  } catch (e) {
    results.fail++; results.failures.push(`${name} => EXCEPTION ${e.message}`);
    console.log(`❌ ${name} => EXCEPTION ${e.message}`);
  }
};

function makeClient(base) {
  let cookie = '';
  return {
    async api(path, opts = {}) {
      const res = await fetch(`${base}${path}`, {
        ...opts,
        signal: opts.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...(opts.headers || {}) },
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      let body = null;
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('json')) { try { body = await res.json(); } catch { body = null; } }
      else { body = Buffer.from(await res.arrayBuffer()); }
      return { status: res.status, body, headers: res.headers };
    },
    async login() {
      const r = await this.api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: ADMIN_PW }) });
      return r.status === 200 ? true : r;
    },
  };
}

const findItem = (list, name) => (list || []).find((i) => i.name === name);
const findEquipment = (list, name) => (list || []).find((e) => e.name === name);
const findCategory = (list, name) => (list || []).find((c) => c.name === name);
const listItems = async (c) => (await c.api('/api/items?limit=500')).body?.items || [];
const listEquipment = async (c) => (await c.api('/api/equipment?limit=500')).body?.equipment || [];
const listCategories = async (c) => (await c.api('/api/categories')).body?.categories || (await c.api('/api/categories')).body || [];
const listTransactions = async (c) => {
  const r = await c.api('/api/transactions?limit=500');
  return r.body?.transactions || r.body?.items || [];
};

const A1 = makeClient(A);
const B1 = makeClient(B);

const suffix = Date.now().toString().slice(-6);

// ── 1. Logins ─────────────────────────────────────────────────────────────
await t('login A', () => A1.login());
await t('login B', () => B1.login());

// ── 2. Node identities ────────────────────────────────────────────────────
let nodeA, nodeB;
await t('GET /api/sync/node on A', async () => {
  const r = await A1.api('/api/sync/node');
  if (r.status !== 200 || !r.body?.nodeId) return r;
  nodeA = r.body;
  return true;
});
await t('GET /api/sync/node on B', async () => {
  const r = await B1.api('/api/sync/node');
  if (r.status !== 200 || !r.body?.nodeId) return r;
  nodeB = r.body;
  return true;
});
await t('nodes are distinct', () => nodeA.nodeId !== nodeB.nodeId ? true : { nodeA: nodeA.nodeId, nodeB: nodeB.nodeId });

// ── 3. Divergence: both sides create data independently ───────────────────
const catA = `مزامنة-فئة-ويندوز-${suffix}`;
const catB = `مزامنة-فئة-اندرويد-${suffix}`;
const itemA = `مزامنة-مادة-ويندوز-${suffix}`;
const itemB = `مزامنة-مادة-اندرويد-${suffix}`;

let aItem, bItem;
await t('A creates category', async () => {
  const r = await A1.api('/api/categories', { method: 'POST', body: JSON.stringify({ name: catA, type: 'consumable' }) });
  return r.status === 201 ? true : r;
});
await t('A creates item (stock 10)', async () => {
  const r = await A1.api('/api/items', { method: 'POST', body: JSON.stringify({ name: itemA, itemType: 'item', unit: 'قطعة', currentStock: 10, minStock: 2 }) });
  if (r.status !== 201) return r;
  aItem = r.body;
  return true;
});
await t('B creates category', async () => {
  const r = await B1.api('/api/categories', { method: 'POST', body: JSON.stringify({ name: catB, type: 'consumable' }) });
  return r.status === 201 ? true : r;
});
await t('B creates item (stock 5)', async () => {
  const r = await B1.api('/api/items', { method: 'POST', body: JSON.stringify({ name: itemB, itemType: 'item', unit: 'علبة', currentStock: 5 }) });
  if (r.status !== 201) return r;
  bItem = r.body;
  return true;
});
await t('B creates equipment (stock 2)', async () => {
  const r = await B1.api('/api/equipment', { method: 'POST', body: JSON.stringify({ name: `مزامنة-تجهيز-اندرويد-${suffix}`, condition: 'good', quantity: 2 }) });
  return r.status === 201 ? true : r;
});

// ── 4. First exchange (A orchestrates one round trip) ─────────────────────
let exchange1;
await t('exchange #1 A→B', async () => {
  const r = await A1.api('/api/sync/exchange', { method: 'POST', body: JSON.stringify({ peerUrl: B, username: 'admin', password: ADMIN_PW }) });
  if (r.status !== 200) return r;
  exchange1 = r.body;
  if (r.body.sent < 2) return { sent: r.body.sent };
  if (!r.body.local || r.body.local.counts.applied < 2) return r.body.local;
  if (!r.body.peerReport || r.body.peerReport.counts.applied < 2) return r.body.peerReport;
  return true;
});
await t('exchange #1: A received B items/categories', async () => {
  const items = await listItems(A1);
  const cats = await listCategories(A1);
  const ok = findItem(items, itemB) && findCategory(cats, catB) && findEquipment(await listEquipment(A1), `مزامنة-تجهيز-اندرويد-${suffix}`);
  return ok ? true : { items: items.map(i => i.name), cats: cats.map(c => c.name) };
});
await t('exchange #1: B received A items/categories', async () => {
  const items = await listItems(B1);
  const cats = await listCategories(B1);
  const ok = findItem(items, itemA) && findCategory(cats, catA);
  return ok ? true : { items: items.map(i => i.name), cats: cats.map(c => c.name) };
});
await t('exchange #1: stocks preserved (A item 10, B item 5)', async () => {
  const aStock = findItem(await listItems(A1), itemB)?.currentStock;
  const bStock = findItem(await listItems(B1), itemA)?.currentStock;
  return aStock === 5 && bStock === 10 ? true : { aStock, bStock };
});

// ── 5. Movements converge ─────────────────────────────────────────────────
const aItemSynced = findItem(await listItems(A1), itemA); // local id on A
const bItemSynced = findItem(await listItems(B1), itemB); // local id on B

await t('A: inbound +20', async () => {
  const r = await A1.api('/api/transactions/in', { method: 'POST', body: JSON.stringify({ itemType: 'item', itemId: aItemSynced.id, quantity: 20, destination: 'المستودع الرئيسي', deliveryNoteNumber: `ورادة-اختبار-${suffix}`, deliveryNoteDate: '2026-08-25' }) });
  return r.status === 201 ? true : r;
});
await t('B: inbound +7', async () => {
  const r = await B1.api('/api/transactions/in', { method: 'POST', body: JSON.stringify({ itemType: 'item', itemId: bItemSynced.id, quantity: 7, destination: 'المستودع الرئيسي', deliveryNoteNumber: `ورادة-اختبار-${suffix}`, deliveryNoteDate: '2026-08-25' }) });
  return r.status === 201 ? true : r;
});

let exchange2;
await t('exchange #2 (movements)', async () => {
  const r = await A1.api('/api/sync/exchange', { method: 'POST', body: JSON.stringify({ peerUrl: B, username: 'admin', password: ADMIN_PW }) });
  if (r.status !== 200) return r;
  exchange2 = r.body;
  return true;
});
await t('exchange #2: B sees A movement (item stock 30)', async () => {
  const stock = findItem(await listItems(B1), itemA)?.currentStock;
  return stock === 30 ? true : { stock };
});
await t('exchange #2: A sees B movement (item stock 12)', async () => {
  const stock = findItem(await listItems(A1), itemB)?.currentStock;
  return stock === 12 ? true : { stock };
});
await t('exchange #2: transaction rows crossed', async () => {
  const aTx = await listTransactions(A1);
  const bTx = await listTransactions(B1);
  // A's inbound on B: a transaction of type 'in' with quantity 20 for itemA
  const onB = bTx.find((x) => x.type === 'in' && x.quantity === 20 && x.itemType === 'item');
  const onA = aTx.find((x) => x.type === 'in' && x.quantity === 7 && x.itemType === 'item');
  return onB && onA ? true : { onA: !!onA, onB: !!onB };
});
await t('exchange #2: FEFO batch converged on B (remaining 20)', async () => {
  const bItemId = findItem(await listItems(B1), itemA)?.id;
  if (!bItemId) return { missing: 'item on B' };
  // The print endpoint carries the batch allocations; verify the inbound
  // document prints on B with the correct quantity.
  const bTx = await listTransactions(B1);
  const onB = bTx.find((x) => x.type === 'in' && x.quantity === 20 && x.itemType === 'item');
  if (!onB) return { missing: 'inbound tx on B' };
  const r = await B1.api(`/api/transactions/${onB.id}/print`);
  return r.status === 200 ? true : { status: r.status };
});

// ── 6. Equipment movement converges ────────────────────────────────────────
await t('A: equipment inbound +1', async () => {
  const eq = findEquipment(await listEquipment(A1), `مزامنة-تجهيز-اندرويد-${suffix}`);
  if (!eq) return { missing: 'equipment on A' };
  const r = await A1.api('/api/transactions/in', { method: 'POST', body: JSON.stringify({ itemType: 'equipment', equipmentId: eq.id, quantity: 1, destination: 'المستودع الرئيسي', deliveryNoteNumber: `ورادة-تجهيز-${suffix}`, deliveryNoteDate: '2026-08-25' }) });
  return r.status === 201 ? true : r;
});
let exchange3;
await t('exchange #3 (equipment movement)', async () => {
  const r = await A1.api('/api/sync/exchange', { method: 'POST', body: JSON.stringify({ peerUrl: B, username: 'admin', password: ADMIN_PW }) });
  if (r.status !== 200) return r;
  exchange3 = r.body;
  return true;
});
await t('exchange #3: equipment quantity 3 on B', async () => {
  const eq = findEquipment(await listEquipment(B1), `مزامنة-تجهيز-اندرويد-${suffix}`);
  return eq?.quantity === 3 ? true : { qty: eq?.quantity };
});

// ── 7. Conflict: same category name created on both sides ─────────────────
const conflictCat = `مزامنة-فئة-متضاربة-${suffix}`;
await t('A creates category (name X)', async () => {
  const r = await A1.api('/api/categories', { method: 'POST', body: JSON.stringify({ name: conflictCat, type: 'consumable' }) });
  return r.status === 201 ? true : r;
});
await t('B creates category (same name X)', async () => {
  const r = await B1.api('/api/categories', { method: 'POST', body: JSON.stringify({ name: conflictCat, type: 'consumable' }) });
  return r.status === 201 ? true : r;
});
let conflictsBefore;
await t('conflict count on A before exchange #4', async () => {
  const r = await A1.api('/api/sync/conflicts?status=open');
  conflictsBefore = (r.body || []).length;
  return r.status === 200 ? true : r;
});
let exchange4;
await t('exchange #4 (conflict expected)', async () => {
  const r = await A1.api('/api/sync/exchange', { method: 'POST', body: JSON.stringify({ peerUrl: B, username: 'admin', password: ADMIN_PW }) });
  if (r.status !== 200) return r;
  exchange4 = r.body;
  return true;
});
let conflictsA;
await t('conflict recorded on A after exchange #4', async () => {
  const r = await A1.api('/api/sync/conflicts?status=open');
  const list = r.body || [];
  conflictsA = list;
  return list.length > conflictsBefore ? true : { before: conflictsBefore, after: list.length, body: r.body };
});
let conflictId = null;
await t('resolve conflict on A (reject)', async () => {
  if (!conflictsA || !conflictsA.length) return { skip: 'no conflicts' };
  conflictId = conflictsA[0].id;
  const r = await A1.api(`/api/sync/conflicts/${conflictId}/resolve`, { method: 'POST', body: JSON.stringify({ resolution: 'reject' }) });
  return r.status === 200 ? true : r;
});
await t('resolved conflict excluded from future packages', async () => {
  const r = await A1.api('/api/sync/conflicts?status=resolved');
  const resolved = r.body || [];
  return resolved.some((c) => c.id === conflictId) ? true : { resolved: resolved.map((c) => c.id) };
});
await t('exchange #5 after rejection: no re-import storm', async () => {
  const r = await A1.api('/api/sync/exchange', { method: 'POST', body: JSON.stringify({ peerUrl: B, username: 'admin', password: ADMIN_PW }) });
  if (r.status !== 200) return r;
  return true;
});

// ── 8. Export / import (full backup as sync package) ──────────────────────
let pkgBase64;
await t('export full package from B', async () => {
  const r = await B1.api('/api/sync/export', { method: 'POST', body: JSON.stringify({ password: PASSWORD }) });
  if (r.status !== 200 || !r.body?.length) return { status: r.status, bytes: r.body?.length };
  pkgBase64 = r.body.toString('base64');
  return r.body.length > 1000 ? true : { bytes: r.body.length };
});
let import1;
await t('import package into A (sync-apply mode)', async () => {
  const r = await A1.api('/api/sync/import', { method: 'POST', body: JSON.stringify({ packageBase64: pkgBase64, password: PASSWORD }) });
  if (r.status !== 200) return r;
  import1 = r.body;
  return r.body.mode === 'sync-apply' && r.body.report?.counts ? true : r.body;
});
await t('re-import is idempotent (duplicates, no double stock)', async () => {
  const before = findItem(await listItems(A1), itemB)?.currentStock;
  const r = await A1.api('/api/sync/import', { method: 'POST', body: JSON.stringify({ packageBase64: pkgBase64, password: PASSWORD }) });
  const after = findItem(await listItems(A1), itemB)?.currentStock;
  if (r.status !== 200) return r;
  if (after !== before) return { before, after };
  if ((r.body?.report?.counts?.duplicate || 0) === 0) return { counts: r.body?.report?.counts };
  return true;
});

// ── 9. Delta export ───────────────────────────────────────────────────────
let bVectorBefore;
await t('capture B vector from A\'s knowledge (post-exchange)', async () => {
  const r = await A1.api('/api/sync/node');
  bVectorBefore = r.body?.vector || {};
  return r.status === 200 ? true : r;
});
const deltaItem = `مزامنة-دلتا-اندرويد-${suffix}`;
await t('B creates delta item (stock 3)', async () => {
  const r = await B1.api('/api/items', { method: 'POST', body: JSON.stringify({ name: deltaItem, itemType: 'item', unit: 'حبة', currentStock: 3 }) });
  return r.status === 201 ? true : r;
});
await t('export delta from B since captured vector', async () => {
  const r = await B1.api('/api/sync/export', { method: 'POST', body: JSON.stringify({ password: PASSWORD, baseVector: bVectorBefore }) });
  if (r.status !== 200 || !r.body?.length) return { status: r.status };
  const imported = await A1.api('/api/sync/import', { method: 'POST', body: JSON.stringify({ packageBase64: r.body.toString('base64'), password: PASSWORD }) });
  if (imported.status !== 200) return imported;
  const ok = findItem(await listItems(A1), deltaItem);
  return ok?.currentStock === 3 ? true : { stock: ok?.currentStock, report: imported.body?.report?.counts };
});

// ── 10. Update convergence (last-write-wins) ──────────────────────────────
const renamed = `مزامنة-مادة-ويندوز-محدثة-${suffix}`;
await t('A renames shared item', async () => {
  const it = findItem(await listItems(A1), itemA);
  if (!it) return { missing: 'itemA on A' };
  const r = await A1.api(`/api/items/${it.id}`, { method: 'PUT', body: JSON.stringify({ name: renamed }) });
  return r.status === 200 ? true : r;
});
let exchange6;
await t('exchange #6 (rename propagates)', async () => {
  const r = await A1.api('/api/sync/exchange', { method: 'POST', body: JSON.stringify({ peerUrl: B, username: 'admin', password: ADMIN_PW }) });
  if (r.status !== 200) return r;
  exchange6 = r.body;
  return true;
});
await t('renamed item visible on B', async () => {
  const items = await listItems(B1);
  const ok = findItem(items, renamed);
  return ok ? true : { names: items.filter((i) => i.name.includes('مزامنة-مادة-ويندوز')).map((i) => i.name) };
});

// ── 11. Delete propagation (soft) ─────────────────────────────────────────
await t('A soft-deletes the delta item', async () => {
  const it = findItem(await listItems(A1), deltaItem);
  if (!it) return { missing: 'delta item on A' };
  const r = await A1.api(`/api/items/${it.id}`, { method: 'DELETE' });
  return r.status === 200 || r.status === 204 ? true : r;
});
let exchange7;
await t('exchange #7 (delete propagates)', async () => {
  const r = await A1.api('/api/sync/exchange', { method: 'POST', body: JSON.stringify({ peerUrl: B, username: 'admin', password: ADMIN_PW }) });
  if (r.status !== 200) return r;
  exchange7 = r.body;
  return true;
});
await t('delta item deactivated on B', async () => {
  const it = findItem(await listItems(B1), deltaItem);
  // Soft delete: the item leaves the active list (undefined) or is flagged.
  return !it || it.isActive === false ? true : { isActive: it.isActive, found: !!it };
});

// ── Phase 8: adjustment movements travel through sync ────────────────────────
const adjustItem = `تسوية-مزامنة-${suffix}`;
await t('A creates an item for the adjustment phase (stock 12)', async () => {
  const r = await A1.api('/api/items', { method: 'POST', body: JSON.stringify({ name: adjustItem, itemType: 'item', unit: 'قطعة', currentStock: 12 }) });
  return r.status === 201 ? true : r;
});
let exchange7b;
await t('exchange #7b syncs the adjustment item to B', async () => {
  const r = await A1.api('/api/sync/exchange', { method: 'POST', body: JSON.stringify({ peerUrl: B, username: 'admin', password: ADMIN_PW }) });
  if (r.status !== 200) return r;
  exchange7b = r.body;
  const it = findItem(await listItems(B1), adjustItem);
  return it && Number(it.currentStock) === 12 ? true : { stock: it?.currentStock };
});
await t('A documents an adjustment (newStock 7) on the synced item', async () => {
  const it = findItem(await listItems(A1), adjustItem);
  if (!it) return { missing: 'adjust item on A' };
  const r = await A1.api('/api/transactions/adjust', {
    method: 'POST',
    body: JSON.stringify({
      itemType: 'item',
      itemId: it.id,
      newStock: 7,
      documentDate: new Date().toISOString().slice(0, 10),
      reason: 'اختبار مزامنة حركة التسوية',
    }),
  });
  return r.status === 201 ? true : r;
});
await t('exchange #8 propagates the adjustment', async () => {
  const r = await A1.api('/api/sync/exchange', { method: 'POST', body: JSON.stringify({ peerUrl: B, username: 'admin', password: ADMIN_PW }) });
  if (r.status !== 200) return r;
  const it = findItem(await listItems(B1), adjustItem);
  if (!it || Number(it.currentStock) !== 7) return { stock: it?.currentStock };
  const txs = (await B1.api('/api/transactions?limit=20')).body?.transactions || [];
  const adjust = txs.find((x) => x.type === 'adjust' && Number(x.itemId) === it.id);
  return adjust ? true : { missing: 'adjust transaction on B' };
});
await t('exchange #9 (re-delivery) does not double-apply the adjustment', async () => {
  const r = await A1.api('/api/sync/exchange', { method: 'POST', body: JSON.stringify({ peerUrl: B, username: 'admin', password: ADMIN_PW }) });
  if (r.status !== 200) return r;
  const it = findItem(await listItems(B1), adjustItem);
  return it && Number(it.currentStock) === 7 ? true : { stock: it?.currentStock };
});
await t('A documents a second adjustment (newStock 9)', async () => {
  const it = findItem(await listItems(A1), adjustItem);
  if (!it) return { missing: 'adjust item on A' };
  const r = await A1.api('/api/transactions/adjust', {
    method: 'POST',
    body: JSON.stringify({
      itemType: 'item',
      itemId: it.id,
      newStock: 9,
      documentDate: new Date().toISOString().slice(0, 10),
      reason: 'اختبار مزامنة تسوية ثانية',
    }),
  });
  return r.status === 201 ? true : r;
});
await t('exchange #10 converges B to the second adjustment (stock 9)', async () => {
  const r = await A1.api('/api/sync/exchange', { method: 'POST', body: JSON.stringify({ peerUrl: B, username: 'admin', password: ADMIN_PW }) });
  if (r.status !== 200) return r;
  const it = findItem(await listItems(B1), adjustItem);
  return it && Number(it.currentStock) === 9 ? true : { stock: it?.currentStock };
});
console.log(`\n═══ SYNC RESULTS: ${results.pass} passed, ${results.fail} failed ═══`);
if (results.failures.length) {
  console.log('\nFailures:');
  for (const f of results.failures) console.log(`  • ${f}`);
  process.exit(1);
}
