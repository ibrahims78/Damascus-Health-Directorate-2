// Comprehensive smoke test for equipment inventory adjustment (approved plan §6)
// Run: node api-adjust-tests.mjs  (against http://127.0.0.1:8080)
const BASE = process.env.API_BASE || 'http://127.0.0.1:8080';
let cookie = '';

const results = { pass: 0, fail: 0, failures: [] };
const t = async (name, fn) => {
  try {
    const r = await fn();
    if (r === true || r === undefined) { results.pass++; console.log(`✅ ${name}`); }
    else { results.fail++; results.failures.push(`${name} → ${JSON.stringify(r)}`); console.log(`❌ ${name} → ${JSON.stringify(r)}`); }
  } catch (e) {
    results.fail++; results.failures.push(`${name} → EXCEPTION ${e.message}`);
    console.log(`❌ ${name} → EXCEPTION ${e.message}`);
  }
};

const ADMIN_PW = process.env.SEED_ADMIN_PASSWORD ?? '***';
const api = async (path, opts = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...(opts.headers || {}) },
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  let body = null;
  try { body = await res.json(); } catch { /* empty */ }
  return { status: res.status, body };
};

// ── login ────────────────────────────────────────────────────────────────────
await t('login admin', async () => {
  const r = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: ADMIN_PW }) });
  return r.status === 200 && (r.body?.role === 'admin' || r.body?.user?.role === 'admin') ? true : r;
});

// ── pick entities ────────────────────────────────────────────────────────────
const items = (await api('/api/items?limit=50')).body.items || [];
const equipmentRes = await api('/api/equipment?limit=200');
const equipmentAll = equipmentRes.body?.equipment || [];
const nonSerial = equipmentAll.filter(e => !e.serialNumber);
const serialized = equipmentAll.find(e => !!e.serialNumber);
const item = items[0];
const eq = nonSerial[0];
console.log(`\n--- fixtures: items=${items.length}, equipment=${equipmentAll.length}, nonSerial=${nonSerial.length}, serialized=${!!serialized}`);
if (!item || !eq) { console.log('SKIP: insufficient fixtures'); process.exit(0); }

// ── item adjustments ─────────────────────────────────────────────────────────
const itemStock0 = item.currentStock;
const itemDelta = itemStock0 > 5 ? -3 : +5;
const itemNew = Math.max(0, itemStock0 + itemDelta);
const d = new Date(); d.setDate(d.getDate() - 2);
const docDate = d.toISOString().slice(0, 10);

await t('item adjust: success (delta≠0)', async () => {
  const r = await api('/api/transactions/adjust', { method: 'POST', body: JSON.stringify({ itemType: 'item', itemId: item.id, newStock: itemNew, documentDate: docDate, reason: 'جرد فعلي للمستودع' }) });
  if (r.status !== 201) return r;
  if (r.body?.type !== 'adjust') return r;
  if (!r.body?.details || r.body.details.previousStock !== itemStock0 || r.body.details.newStock !== itemNew) return { got: r.body?.details };
  return true;
});

await t('item adjust: quantity actually updated', async () => {
  const r = await api(`/api/items/${item.id}`);
  return r.status === 200 && r.body?.currentStock === itemNew ? true : r;
});

await t('item adjust: NO_STOCK_CHANGE on same stock (409)', async () => {
  const r = await api('/api/transactions/adjust', { method: 'POST', body: JSON.stringify({ itemType: 'item', itemId: item.id, newStock: itemNew, documentDate: docDate, reason: 'جرد فعلي للمستودع' }) });
  return r.status === 400 && r.body?.code === 'NO_STOCK_CHANGE' ? true : r;
});

await t('item adjust: REASON_TOO_SHORT (400)', async () => {
  const r = await api('/api/transactions/adjust', { method: 'POST', body: JSON.stringify({ itemType: 'item', itemId: item.id, newStock: itemNew, documentDate: docDate, reason: 'جرد' }) });
  return r.status === 400 && r.body?.code === 'REASON_TOO_SHORT' ? true : r;
});

await t('item adjust: REQUIRED_FIELD missing reason (400)', async () => {
  const r = await api('/api/transactions/adjust', { method: 'POST', body: JSON.stringify({ itemType: 'item', itemId: item.id, newStock: itemNew, documentDate: docDate }) });
  return r.status === 400 && r.body?.code === 'REQUIRED_FIELD' ? true : r;
});

await t('item adjust: INVALID_DOCUMENT_DATE missing (400)', async () => {
  const r = await api('/api/transactions/adjust', { method: 'POST', body: JSON.stringify({ itemType: 'item', itemId: item.id, newStock: itemNew, reason: 'جرد فعلي للمستودع' }) });
  return r.status === 400 && (r.body?.code === 'INVALID_DOCUMENT_DATE') ? true : r;
});

await t('item adjust: ENTITY_TYPE_MISMATCH both ids (400)', async () => {
  const r = await api('/api/transactions/adjust', { method: 'POST', body: JSON.stringify({ itemType: 'item', itemId: item.id, equipmentId: eq.id, newStock: 1, documentDate: docDate, reason: 'جرد فعلي للمستودع' }) });
  return r.status === 400 && r.body?.code === 'ENTITY_TYPE_MISMATCH' ? true : r;
});

await t('item adjust: ENTITY_TYPE_MISMATCH neither id (400)', async () => {
  const r = await api('/api/transactions/adjust', { method: 'POST', body: JSON.stringify({ itemType: 'item', newStock: 1, documentDate: docDate, reason: 'جرد فعلي للمستودع' }) });
  return r.status === 400 && r.body?.code === 'ENTITY_TYPE_MISMATCH' ? true : r;
});

await t('item adjust: INVALID_STOCK negative (400)', async () => {
  const r = await api('/api/transactions/adjust', { method: 'POST', body: JSON.stringify({ itemType: 'item', itemId: item.id, newStock: -1, documentDate: docDate, reason: 'جرد فعلي للمستودع' }) });
  return r.status === 400 && r.body?.code === 'INVALID_STOCK' ? true : r;
});

// ── equipment adjustments ────────────────────────────────────────────────────
const eqStock0 = eq.quantity;
const eqNew = eqStock0 + 2;

await t('equipment adjust: success (delta≠0)', async () => {
  const r = await api('/api/transactions/adjust', { method: 'POST', body: JSON.stringify({ itemType: 'equipment', equipmentId: eq.id, newStock: eqNew, documentDate: docDate, reason: 'جرد فعلي للتجهيزات' }) });
  if (r.status !== 201) return r;
  const d2 = r.body?.details;
  if (r.body?.itemType !== 'equipment') return r;
  if (!d2 || d2.previousStock !== eqStock0 || d2.newStock !== eqNew || d2.delta !== 2) return { got: d2 };
  if (d2.openCustody === undefined || d2.availableBefore === undefined || !d2.equipmentNameSnap) return { got: d2 };
  return true;
});

await t('equipment adjust: quantity actually updated', async () => {
  const r = await api(`/api/equipment/${eq.id}`);
  return r.status === 200 && r.body?.quantity === eqNew ? true : r;
});

await t('equipment adjust: print endpoint exposes details', async () => {
  const r = await api('/api/transactions?limit=1&type=adjust');
  const tx = r.body?.transactions?.[0];
  if (!tx) return 'no adjustment transaction found';
  const p = await api(`/api/transactions/${tx.id}/print`);
  return p.status === 200 && p.body?.transaction?.details?.newStock !== undefined ? true : { status: p.status, body: p.body };
});

// ── serialized equipment block ───────────────────────────────────────────────
if (serialized) {
  await t('equipment adjust: SERIAL_EQUIPMENT_ADJUSTMENT_BLOCKED (409)', async () => {
    const r = await api('/api/transactions/adjust', { method: 'POST', body: JSON.stringify({ itemType: 'equipment', equipmentId: serialized.id, newStock: 1, documentDate: docDate, reason: 'جرد فعلي للتجهيزات' }) });
    return r.status === 409 && r.body?.code === 'SERIAL_EQUIPMENT_ADJUSTMENT_BLOCKED' ? true : r;
  });
} else {
  console.log('⚠ no serialized equipment fixture — creating one');
  const cr = await api('/api/equipment', { method: 'POST', body: JSON.stringify({ name: 'جهاز اختبار مسلسل', equipmentType: 'جهاز', serialNumber: 'SN-TEST-0001', quantity: 1 }) });
  if (cr.status === 201) {
    const sid = cr.body?.id || cr.body?.equipment?.id;
    await t('equipment adjust: SERIAL_EQUIPMENT_ADJUSTMENT_BLOCKED (409)', async () => {
      const r = await api('/api/transactions/adjust', { method: 'POST', body: JSON.stringify({ itemType: 'equipment', equipmentId: sid, newStock: 2, documentDate: docDate, reason: 'جرد فعلي للتجهيزات' }) });
      return r.status === 409 && r.body?.code === 'SERIAL_EQUIPMENT_ADJUSTMENT_BLOCKED' ? true : r;
    });
    await api(`/api/equipment/${sid}`, { method: 'DELETE' });
  } else { console.log(`⚠ could not create serialized fixture: ${cr.status}`); }
}

// ── custody floor (EQUIPMENT_CUSTODY_BALANCE) ────────────────────────────────
// Ensure there is at least one open custody to test the floor.
const custRes = await api('/api/custodies?limit=50');
let openCustody = (custRes.body?.custodies || []).find(c => (c.quantity ?? 0) - (c.returnedQuantity ?? 0) > 0);
if (!openCustody && nonSerial.length > 1) {
  // create custody_out for the second non-serial equipment
  const eq2 = nonSerial[1];
  const cr = await api('/api/transactions/custody-out', { method: 'POST', body: JSON.stringify({ itemType: 'equipment', equipmentId: eq2.id, quantity: 1, holderName: 'مختبِر العهود', custodyNoteNumber: 'TEST-NOTE-1', custodyDate: docDate, custodyLocation: 'قسم الطوارئ' }) });
  console.log(`  (created custody fixture: ${cr.status})`);
  if (cr.status === 201) {
    openCustody = { equipmentId: eq2.id, quantity: 1, returnedQuantity: 0 };
    // try adjusting that equipment below 1 → must be rejected
    await t('equipment adjust: EQUIPMENT_CUSTODY_BALANCE below floor (409)', async () => {
      const r = await api('/api/transactions/adjust', { method: 'POST', body: JSON.stringify({ itemType: 'equipment', equipmentId: eq2.id, newStock: 0, documentDate: docDate, reason: 'جرد فعلي للتجهيزات' }) });
      return r.status === 409 && r.body?.code === 'EQUIPMENT_CUSTODY_BALANCE' ? true : r;
    });
  }
}
if (openCustody) {
  const cEqId = openCustody.equipmentId;
  const cur = (await api(`/api/equipment/${cEqId}`)).body;
  const floor = openCustody.quantity - (openCustody.returnedQuantity || 0);
  if (cur && cur.quantity > floor) {
    await t('equipment adjust: EQUIPMENT_CUSTODY_BALANCE below floor (409)', async () => {
      const r = await api('/api/transactions/adjust', { method: 'POST', body: JSON.stringify({ itemType: 'equipment', equipmentId: cEqId, newStock: floor - 1, documentDate: docDate, reason: 'جرد فعلي للتجهيزات' }) });
      return r.status === 409 && r.body?.code === 'EQUIPMENT_CUSTODY_BALANCE' ? true : r;
    });
  } else {
    console.log(`⚠ custody fixture on eq ${cEqId} but quantity=${cur?.quantity} floor=${floor}`);
  }
} else {
  console.log('⚠ no open custody available — custody floor test skipped (unit-level coverage in service tests)');
}

// ── edit vs balance separation ───────────────────────────────────────────────
await t('equipment PUT: quantity change rejected (409)', async () => {
  const r = await api(`/api/equipment/${eq.id}`, { method: 'PUT', body: JSON.stringify({ ...eq, quantity: eq.quantity + 50 }) });
  return r.status === 409 && r.body?.code === 'EQUIPMENT_QUANTITY_NOT_EDITABLE' ? true : r;
});

await t('equipment PUT: idempotent same quantity allowed (200)', async () => {
  const fresh = (await api(`/api/equipment/${eq.id}`)).body;
  const r = await api(`/api/equipment/${eq.id}`, { method: 'PUT', body: JSON.stringify({ ...fresh, quantity: fresh.quantity, notes: 'اختبار تسوية' }) });
  return r.status === 200 ? true : r;
});

// ── history exposes details ──────────────────────────────────────────────────
await t('equipment history: adjust movement includes details snapshot', async () => {
  const r = await api(`/api/equipment/${eq.id}/history?type=adjust`);
  if (r.status !== 200) return r;
  const mv = (r.body?.movements || []).find(m => m.type === 'adjust');
  return mv && mv.details && mv.details.newStock !== undefined ? true : { movements: r.body?.movements?.length };
});

// ── restore item stock to baseline (keep DB tidy) ────────────────────────────
await t('cleanup: restore item stock', async () => {
  if (itemNew === itemStock0) return true;
  const r = await api('/api/transactions/adjust', { method: 'POST', body: JSON.stringify({ itemType: 'item', itemId: item.id, newStock: itemStock0, documentDate: docDate, reason: 'إعادة الرصيد بعد اختبار التسوية' }) });
  return r.status === 201 ? true : r;
});

console.log(`\n══════════════════════════════════════`);
console.log(`RESULT: ${results.pass} passed, ${results.fail} failed`);
if (results.failures.length) {
  console.log('Failures:');
  results.failures.forEach(f => console.log(`  • ${f}`));
}
process.exit(results.fail ? 1 : 0);
