import { dmePackageSummary, readDmeSyncPackageInWorker, writeDmeSyncPackage } from './dme-sync-browser';
import {
  createCategoryLookup,
  createUnitLookup,
  DEFAULT_INVENTORY_UNITS,
  normalizeHeader,
  validateInventoryOpeningBatchRows,
  validateInventoryImportRows,
} from '@workspace/api-zod';

type PublicUser = {
  id: number;
  username: string;
  fullName: string;
  role: 'admin' | 'warehouse_manager' | 'viewer';
};

type OfflineState = {
  version: 2;
  nextId: number;
  currentUserId: number | null;
  nodeIdentity: {
    nodeId: string;
    installationId: string;
    nodeType: 'android' | 'windows';
    keyId: string | null;
    originSequence: number;
    createdAt: string;
  };
  entityIds: Array<{ entityType: string; localId: number; globalId: string; createdAt: string }>;
  changeLog: Array<Record<string, unknown>>;
  outbox: Array<Record<string, unknown>>;
  inbox: Array<Record<string, unknown>>;
  syncCursors: Array<Record<string, unknown>>;
  conflictQueue: Array<Record<string, unknown>>;
  tombstones: Array<Record<string, unknown>>;
  users: Array<PublicUser & { passwordHash: string; passwordSalt: string; isActive: boolean; createdAt: string }>;
  settings: {
    id: number;
    setupCompleted: boolean;
    setupAt: string | null;
    orgName: string;
    orgSubtitle: string | null;
    expiryAlertDays: number;
    unitsList: string | null;
    updatedAt: string;
  };
  categories: Array<{ id: number; name: string; type: string; createdAt: string }>;
  items: Array<Record<string, unknown>>;
  equipment: Array<Record<string, unknown>>;
  recipients: Array<Record<string, unknown>>;
  exitReasons: Array<Record<string, unknown>>;
  transactions: Array<Record<string, unknown>>;
  inventoryBatches: Array<Record<string, unknown>>;
  transactionBatchAllocations: Array<Record<string, unknown>>;
  personalCustodies: Array<Record<string, unknown>>;
  custodyReturns: Array<Record<string, unknown>>;
  damageRecords: Array<Record<string, unknown>>;
  centralReturns: Array<Record<string, unknown>>;
  alerts: Array<Record<string, unknown>>;
  auditLog: Array<Record<string, unknown>>;
};

const DB_NAME = 'damascus-emergency-inventory-offline';
const DB_VERSION = 2;
const STORE_NAME = 'state';
const STATE_KEY = 'current';
const PREVIEW_KEY = 'pending-restore-preview';
const OFFLINE_HEADER = 'X-Damascus-Offline';
const INDEXED_DB_TIMEOUT_MS = 15_000;
const OFFLINE_REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_ORG_NAME = 'مستودعات مديرية صحة دمشق';

function isLegacyOrgName(value: string): boolean {
  const normalized = value.trim();
  return (
    normalized !== DEFAULT_ORG_NAME &&
    /^(منظومة|نظام)\s/u.test(normalized) &&
    /(الإحالة|الاحالة|الإسعاف والطوارئ|الاسعاف والطوارئ)/u.test(normalized)
  );
}

let statePromise: Promise<OfflineState> | undefined;
let writeQueue = Promise.resolve();
let pendingDmePreview: {
  token: string;
  packageHash: string;
  mode: 'full' | 'merge';
  pkg: Awaited<ReturnType<typeof readDmeSyncPackageInWorker>>;
} | null = null;

function now() {
  return new Date().toISOString();
}

function publicUser(user: OfflineState['users'][number]): PublicUser {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
  };
}

function initialState(): OfflineState {
  const timestamp = now();
  return {
    version: 2,
    nextId: 1,
    currentUserId: null,
    nodeIdentity: {
      nodeId: crypto.randomUUID(),
      installationId: crypto.randomUUID(),
      nodeType: /Android/i.test(navigator.userAgent) ? 'android' : 'windows',
      keyId: null,
      originSequence: 0,
      createdAt: timestamp,
    },
    entityIds: [],
    changeLog: [],
    outbox: [],
    inbox: [],
    syncCursors: [],
    conflictQueue: [],
    tombstones: [],
    users: [],
    settings: {
      id: 1,
      setupCompleted: false,
      setupAt: null,
      orgName: DEFAULT_ORG_NAME,
      orgSubtitle: null,
      expiryAlertDays: 30,
      unitsList: null,
      updatedAt: timestamp,
    },
    categories: [
      { id: 1, name: 'مواد طبية', type: 'consumable', createdAt: timestamp },
      { id: 2, name: 'تجهيزات', type: 'equipment', createdAt: timestamp },
    ],
    items: [],
    equipment: [],
    recipients: [],
    exitReasons: [
      { id: 1, name: 'صرف اعتيادي', isSystem: true, isActive: true, createdAt: timestamp },
      { id: 2, name: 'تلف', isSystem: true, isActive: true, createdAt: timestamp },
      { id: 3, name: 'إرجاع مركزي', isSystem: true, isActive: true, createdAt: timestamp },
    ],
    transactions: [],
    inventoryBatches: [],
    transactionBatchAllocations: [],
    personalCustodies: [],
    custodyReturns: [],
    damageRecords: [],
    centralReturns: [],
    alerts: [],
    auditLog: [],
  };
}

function withTimeout<T>(promise: Promise<T>, message: string, timeoutMs = INDEXED_DB_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(message));
    }, timeoutMs);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return withTimeout(
    new Promise((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        request = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (error) {
        reject(error);
        return;
      }
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        // Close stale connections so a schema upgrade cannot remain blocked
        // forever in Electron.
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => reject(request.error ?? new Error('تعذر فتح قاعدة البيانات المحلية'));
      request.onblocked = () => reject(new Error('قاعدة البيانات المحلية مشغولة بعملية أخرى'));
    }),
    'انتهت مهلة فتح قاعدة البيانات المحلية',
  );
}

async function loadState(): Promise<OfflineState> {
  const db = await openDatabase();
  let existing: OfflineState | undefined;
  try {
    existing = await withTimeout(
      new Promise<OfflineState | undefined>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const request = transaction.objectStore(STORE_NAME).get(STATE_KEY);
        request.onsuccess = () => resolve(request.result as OfflineState | undefined);
        request.onerror = () => reject(request.error);
        transaction.onerror = () => reject(transaction.error ?? new Error('تعذر قراءة البيانات المحلية'));
        transaction.onabort = () => reject(transaction.error ?? new Error('تم إلغاء قراءة البيانات المحلية'));
      }),
      'انتهت مهلة قراءة البيانات المحلية',
    );
  } finally {
    db.close();
  }
  if (existing) {
    const fresh = initialState();
    const existingSettings = existing.settings ?? fresh.settings;
    return {
      ...fresh,
      ...existing,
      version: 2,
      settings: {
        ...fresh.settings,
        ...existingSettings,
        orgName: isLegacyOrgName(existingSettings.orgName)
          ? DEFAULT_ORG_NAME
          : existingSettings.orgName,
      },
      nodeIdentity: existing.nodeIdentity ?? fresh.nodeIdentity,
      entityIds: existing.entityIds ?? [],
      changeLog: existing.changeLog ?? [],
      outbox: existing.outbox ?? [],
      inbox: existing.inbox ?? [],
      syncCursors: existing.syncCursors ?? [],
      conflictQueue: existing.conflictQueue ?? [],
      tombstones: existing.tombstones ?? [],
      inventoryBatches: existing.inventoryBatches ?? [],
      transactionBatchAllocations: existing.transactionBatchAllocations ?? [],
      personalCustodies: existing.personalCustodies ?? [],
      custodyReturns: existing.custodyReturns ?? [],
      damageRecords: existing.damageRecords ?? [],
      centralReturns: existing.centralReturns ?? [],
    };
  }
  const fresh = initialState();
  await saveState(fresh);
  return fresh;
}

async function saveState(state: OfflineState) {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const request = transaction.objectStore(STORE_NAME).put(state, STATE_KEY);
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve();
      };
      const timeout = window.setTimeout(() => {
        try {
          transaction.abort();
        } catch {
          // The transaction may already have completed or aborted.
        }
        finish(new Error('انتهت مهلة حفظ البيانات المحلية'));
      }, 15000);
      const clear = () => window.clearTimeout(timeout);
      request.onerror = () => {
        clear();
        finish(request.error ?? new Error('تعذر حفظ البيانات المحلية'));
      };
      transaction.oncomplete = () => {
        clear();
        finish();
      };
      transaction.onerror = () => {
        clear();
        finish(transaction.error ?? new Error('تعذر حفظ البيانات المحلية'));
      };
      transaction.onabort = () => {
        clear();
        finish(transaction.error ?? new Error('تم إلغاء حفظ البيانات المحلية'));
      };
    });
  } finally {
    db.close();
  }
}

async function savePendingPreview(preview: NonNullable<typeof pendingDmePreview>) {
  const db = await openDatabase();
  try {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const request = transaction.objectStore(STORE_NAME).put(preview, PREVIEW_KEY);
        request.onerror = () => reject(request.error ?? new Error('تعذر حفظ نقطة الاستعادة المحلية'));
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('تعذر حفظ نقطة الاستعادة المحلية'));
        transaction.onabort = () => reject(transaction.error ?? new Error('تم إلغاء حفظ نقطة الاستعادة المحلية'));
      }),
      'انتهت مهلة حفظ نقطة الاستعادة المحلية',
    );
  } finally {
    db.close();
  }
}

async function loadPendingPreview() {
  const db = await openDatabase();
  const preview = await new Promise<NonNullable<typeof pendingDmePreview> | null>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(PREVIEW_KEY);
    request.onsuccess = () => resolve((request.result as NonNullable<typeof pendingDmePreview> | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return preview;
}

async function clearPendingPreview() {
  const db = await openDatabase();
  try {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const request = transaction.objectStore(STORE_NAME).delete(PREVIEW_KEY);
        request.onerror = () => reject(request.error ?? new Error('تعذر حذف نقطة الاستعادة المحلية'));
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('تعذر حذف نقطة الاستعادة المحلية'));
        transaction.onabort = () => reject(transaction.error ?? new Error('تم إلغاء حذف نقطة الاستعادة المحلية'));
      }),
      'انتهت مهلة حذف نقطة الاستعادة المحلية',
    );
  } finally {
    db.close();
  }
}

function getState() {
  if (!statePromise) {
    statePromise = loadState().catch((error) => {
      // Do not cache a rejected IndexedDB promise: one transient failure
      // must not leave every later mutation waiting forever.
      statePromise = undefined;
      throw error;
    });
  }
  return statePromise;
}

async function mutate<T>(callback: (state: OfflineState) => Promise<T> | T): Promise<T> {
  const run = writeQueue.then(async () => {
    const state = await getState();
    const result = await callback(state);
    await saveState(state);
    return result;
  });
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function read<T>(callback: (state: OfflineState) => T): Promise<T> {
  return callback(await getState());
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', [OFFLINE_HEADER]: '1', ...headers },
  });
}

function failure(status: number, error: string) {
  return json({ error }, status);
}

function idFrom(pathname: string, segment: string) {
  const match = pathname.match(new RegExp(`/${segment}/(\\d+)(?:/|$)`));
  return match ? Number(match[1]) : undefined;
}

function nextId(state: OfflineState) {
  const id = state.nextId;
  state.nextId += 1;
  return id;
}

const STATE_KEY_BY_ENTITY: Record<string, string> = {
  category: 'categories',
  item: 'items',
  equipment: 'equipment',
  transaction: 'transactions',
  inventory_batch: 'inventoryBatches',
  batch_allocation: 'transactionBatchAllocations',
  personal_custody: 'personalCustodies',
  custody_return: 'custodyReturns',
  damage_record: 'damageRecords',
  central_return: 'centralReturns',
  recipient: 'recipients',
  exit_reason: 'exitReasons',
  user: 'users',
};

function resolveGlobalId(state: OfflineState, entityType: string, globalId: string): number | null {
  const mapping = state.entityIds.find((entry) => entry.entityType === entityType && entry.globalId === globalId);
  return mapping ? mapping.localId : null;
}

function ensureLocalId(state: OfflineState, entityType: string, globalId: string): number {
  const existing = resolveGlobalId(state, entityType, globalId);
  if (existing != null) return existing;
  const localId = state.nextId;
  state.nextId += 1;
  state.entityIds.push({ entityType, localId, globalId, createdAt: now() });
  return localId;
}

function syncVector(state: OfflineState): Record<string, number> {
  const vector: Record<string, number> = {};
  for (const change of state.changeLog) {
    const node = text(change.originNodeId);
    const seq = numberValue(change.originSequence);
    if (node && seq > (vector[node] ?? 0)) vector[node] = seq;
  }
  return vector;
}

function applyOfflineRow(state: OfflineState, change: Record<string, unknown>) {
  const key = STATE_KEY_BY_ENTITY[text(change.entityType)];
  if (!key || key === 'users') throw new Error(`نوع الكيان غير مدعوم: ${text(change.entityType)}`);
  const rows = (state as unknown as Record<string, unknown[]>)[key];
  const row = { ...((change.payload ?? {}) as Record<string, unknown>) };
  if (text(change.entityType) === 'item' && row.categoryGlobalId != null) {
    const categoryId = resolveGlobalId(state, 'category', String(row.categoryGlobalId));
    if (categoryId != null) row.categoryId = categoryId;
    else delete row.categoryId;
  }
  delete row.categoryGlobalId;
  delete row.itemGlobalId;
  delete row.equipmentGlobalId;
  delete row.transactionGlobalId;
  const localId = ensureLocalId(state, text(change.entityType), text(change.entityGlobalId));
  row.id = localId;
  const index = rows.findIndex((entry) => numberValue((entry as Record<string, unknown>).id) === localId);
  if (change.changeType === 'delete') row.isActive = false;
  if (index >= 0) rows[index] = { ...(rows[index] as object), ...row };
  else rows.push(row);
  if (localId >= state.nextId) state.nextId = localId + 1;
}

function applyOfflineTransactionBundle(state: OfflineState, change: Record<string, unknown>) {
  const bundle = (change.payload ?? {}) as { transaction?: Record<string, unknown>; effects?: Array<Record<string, unknown>> };
  if (!bundle.transaction) throw new Error('حزمة حركة غير مكتملة');
  const txRow = { ...bundle.transaction };
  if (txRow.itemGlobalId != null) {
    const itemId = resolveGlobalId(state, 'item', String(txRow.itemGlobalId));
    if (itemId == null) throw new Error('المادة المرجعية للحركة غير موجودة محلياً');
    txRow.itemId = itemId;
  }
  if (txRow.equipmentGlobalId != null) {
    const equipmentId = resolveGlobalId(state, 'equipment', String(txRow.equipmentGlobalId));
    if (equipmentId == null) throw new Error('المعدة المرجعية للحركة غير موجودة محلياً');
    txRow.equipmentId = equipmentId;
  }
  delete txRow.itemGlobalId;
  delete txRow.equipmentGlobalId;
  const txLocalId = ensureLocalId(state, 'transaction', text(change.entityGlobalId));
  txRow.id = txLocalId;
  if (state.transactions.some((entry) => text(entry.documentNumber) === text(txRow.documentNumber))) {
    txRow.documentNumber = `${text(txRow.documentNumber)}-${String(change.originNodeId ?? 'node').slice(0, 8)}`;
  }
  const txIndex = state.transactions.findIndex((entry) => numberValue(entry.id) === txLocalId);
  if (txIndex >= 0) state.transactions[txIndex] = { ...state.transactions[txIndex], ...txRow };
  else state.transactions.push(txRow);
  if (txLocalId >= state.nextId) state.nextId = txLocalId + 1;

  for (const effect of bundle.effects ?? []) {
    const key = STATE_KEY_BY_ENTITY[text(effect.entityType)];
    if (!key || key === 'users') continue;
    const rows = (state as unknown as Record<string, unknown[]>)[key];
    const row = { ...((effect.row ?? {}) as Record<string, unknown>) };
    if (row.itemGlobalId != null) {
      const itemId = resolveGlobalId(state, 'item', String(row.itemGlobalId));
      if (itemId != null) row.itemId = itemId;
    }
    if (row.equipmentGlobalId != null) {
      const equipmentId = resolveGlobalId(state, 'equipment', String(row.equipmentGlobalId));
      if (equipmentId != null) row.equipmentId = equipmentId;
    }
    if (row.transactionGlobalId != null) {
      const transactionId = resolveGlobalId(state, 'transaction', String(row.transactionGlobalId));
      if (transactionId != null) row.transactionId = transactionId;
    }
    if (row.batchGlobalId != null) {
      const batchId = resolveGlobalId(state, 'inventory_batch', String(row.batchGlobalId));
      if (batchId != null) row.batchId = batchId;
    }
    if (row.custodyGlobalId != null) {
      const custodyId = resolveGlobalId(state, 'personal_custody', String(row.custodyGlobalId));
      if (custodyId != null) row.custodyId = custodyId;
    }
    delete row.itemGlobalId;
    delete row.equipmentGlobalId;
    delete row.transactionGlobalId;
    delete row.batchGlobalId;
    delete row.custodyGlobalId;
    delete row.sourceTransactionGlobalId;
    const localId = ensureLocalId(state, text(effect.entityType), text(effect.entityGlobalId));
    row.id = localId;
    const index = rows.findIndex((entry) => numberValue((entry as Record<string, unknown>).id) === localId);
    if (index >= 0) rows[index] = { ...(rows[index] as object), ...row };
    else rows.push(row);
    if (localId >= state.nextId) state.nextId = localId + 1;
  }
}

function applyOfflineChanges(state: OfflineState, changes: unknown[]) {
  const counts = { received: changes.length, applied: 0, duplicate: 0, conflicts: 0, rejected: 0 };
  for (const raw of changes) {
    const change = raw as Record<string, unknown>;
    const changeId = text(change.changeId);
    const operationId = text(change.operationId);
    if (state.changeLog.some((entry) => entry.changeId === changeId || entry.operationId === operationId)) {
      counts.duplicate += 1;
      continue;
    }
    if (text(change.status) === 'rejected') {
      counts.rejected += 1;
      continue;
    }
    try {
      if (text(change.entityType) === 'transaction' && change.payload && typeof change.payload === 'object' && (change.payload as { transaction?: unknown }).transaction) {
        applyOfflineTransactionBundle(state, change);
      } else {
        applyOfflineRow(state, change);
      }
      state.changeLog.push({
        changeId,
        operationId,
        entityType: text(change.entityType),
        entityGlobalId: text(change.entityGlobalId),
        localEntityId: change.localEntityId ?? null,
        changeType: text(change.changeType, 'create'),
        payload: change.payload ?? {},
        originNodeId: text(change.originNodeId, state.nodeIdentity.nodeId),
        originSequence: numberValue(change.originSequence, 0),
        createdAt: text(change.createdAt, now()),
        receivedAt: now(),
        appliedAt: now(),
        status: 'applied',
        rejectionCode: null,
      });
      counts.applied += 1;
    } catch (error) {
      state.conflictQueue.push({
        id: state.nextId,
        changeId,
        conflictCode: 'MATERIALIZE_FAILED',
        entityType: text(change.entityType),
        entityGlobalId: text(change.entityGlobalId),
        severity: 'medium',
        status: 'open',
        message: error instanceof Error ? error.message : 'تعذر تطبيق التغيير',
        createdAt: now(),
      });
      state.nextId += 1;
      state.changeLog.push({
        changeId,
        operationId,
        entityType: text(change.entityType),
        entityGlobalId: text(change.entityGlobalId),
        localEntityId: change.localEntityId ?? null,
        changeType: text(change.changeType, 'create'),
        payload: change.payload ?? {},
        originNodeId: text(change.originNodeId, state.nodeIdentity.nodeId),
        originSequence: numberValue(change.originSequence, 0),
        createdAt: text(change.createdAt, now()),
        receivedAt: now(),
        appliedAt: null,
        status: 'conflict',
        rejectionCode: null,
      });
      counts.conflicts += 1;
    }
  }
  return counts;
}

function recordOfflineChange(
  state: OfflineState,
  entityType: string,
  localId: number | null,
  changeType: 'create' | 'update' | 'delete',
  payload: Record<string, unknown>,
) {
  const existing = localId == null
    ? undefined
    : state.entityIds.find((entry) => entry.entityType === entityType && entry.localId === localId);
  const globalId = existing?.globalId ?? crypto.randomUUID();
  if (!existing && localId != null) {
    state.entityIds.push({
      entityType,
      localId,
      globalId,
      createdAt: now(),
    });
  }

  state.nodeIdentity.originSequence += 1;
  const operationId = crypto.randomUUID();
  const changeId = crypto.randomUUID();
  const change = {
    changeId,
    operationId,
    entityType,
    entityGlobalId: globalId,
    localEntityId: localId,
    changeType,
    payload,
    originNodeId: state.nodeIdentity.nodeId,
    originSequence: state.nodeIdentity.originSequence,
    createdAt: now(),
    receivedAt: null,
    appliedAt: now(),
    status: 'local-pending',
    rejectionCode: null,
  };
  state.changeLog.push(change);
  state.outbox.push({
    changeId,
    status: 'pending',
    createdAt: change.createdAt,
    exportedAt: null,
    acknowledgedAt: null,
  });
  if (changeType === 'delete') {
    state.tombstones.push({
      entityType,
      entityGlobalId: globalId,
      deletedByChangeId: changeId,
      originNodeId: state.nodeIdentity.nodeId,
      createdAt: change.createdAt,
      propagated: false,
    });
  }
  return { changeId, operationId, globalId };
}

function readBody(init?: RequestInit): any {
  const body = init?.body;
  if (!body || typeof body !== 'string') return {};
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function getCurrentUser(state: OfflineState) {
  return state.users.find((user) => user.id === state.currentUserId && user.isActive);
}

function auth(state: OfflineState) {
  const user = getCurrentUser(state);
  return user ? publicUser(user) : null;
}

function roleAllowed(user: PublicUser, roles: PublicUser['role'][]) {
  return roles.includes(user.role);
}

const PBKDF2_ITERATIONS = 310_000;

function toHex(value: Uint8Array) {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// PBKDF2-SHA-256 (310k iterations) replaces the previous single-round
// SHA-256(salt:password), which was trivially fast to brute-force on GPU.
// Hashes are stored as `pbkdf2$<iterations>$<hex>` so parameters can be
// raised later without breaking old entries.
export async function passwordHash(password: string, salt: string): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toHex(new Uint8Array(bits))}`;
}

export async function verifyPassword(
  password: string,
  salt: string,
  storedHash: string,
): Promise<boolean> {
  if (storedHash.startsWith('pbkdf2$')) {
    return (await passwordHash(password, salt)) === storedHash;
  }
  // Legacy single-round SHA-256(salt:password).
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${salt}:${password}`),
  );
  return toHex(new Uint8Array(digest)) === storedHash;
}

function itemWithCategory(state: OfflineState, item: Record<string, unknown>): Record<string, unknown> {
  const category = state.categories.find((entry) => numberValue(entry.id) === numberValue(item.categoryId));
  return { ...item, categoryName: category?.name ?? null };
}

function paged<T>(rows: T[], searchParams: URLSearchParams) {
  const page = Math.max(1, Number(searchParams.get('page') ?? 1));
  const limit = Math.max(1, Math.min(5000, Number(searchParams.get('limit') ?? 50)));
  const start = (page - 1) * limit;
  return { rows: rows.slice(start, start + limit), total: rows.length, page, limit };
}

function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sortRows<T extends Record<string, unknown>>(rows: T[], key: string | null, direction: string | null) {
  if (!key) return rows;
  const sign = direction === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? ''), 'ar', {
    numeric: true,
  }) * sign);
}

function addAudit(state: OfflineState, user: PublicUser | null, action: string, entityType: string, entityId?: number) {
  state.auditLog.unshift({
    id: nextId(state),
    userId: user?.id ?? null,
    userNameSnap: user?.fullName ?? 'محلي',
    action,
    entityType,
    entityId: entityId ?? null,
    details: null,
    createdAt: now(),
  });
}

function itemFromInput(state: OfflineState, body: Record<string, unknown>, existing?: Record<string, unknown>) {
  const timestamp = now();
  return {
    ...(existing ?? {}),
    id: existing?.id ?? nextId(state),
    code: body.code ?? existing?.code ?? null,
    name: text(body.name, text(existing?.name)),
    categoryId: body.categoryId ?? existing?.categoryId ?? null,
    itemType: text(body.itemType, text(existing?.itemType, 'consumable')),
    unit: text(body.unit, text(existing?.unit, 'قطعة')),
    currentStock: numberValue(body.currentStock, numberValue(existing?.currentStock)),
    minStock: numberValue(body.minStock, numberValue(existing?.minStock)),
    expiryDate: body.expiryDate ?? existing?.expiryDate ?? null,
    batchNumber: body.batchNumber ?? existing?.batchNumber ?? null,
    location: body.location ?? existing?.location ?? null,
    supplier: body.supplier ?? existing?.supplier ?? null,
    notes: body.notes ?? existing?.notes ?? null,
    isActive: existing?.isActive ?? true,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
}

function equipmentFromInput(state: OfflineState, body: Record<string, unknown>, existing?: Record<string, unknown>) {
  const timestamp = now();
  return {
    ...(existing ?? {}),
    id: existing?.id ?? nextId(state),
    name: text(body.name, text(existing?.name)),
    equipmentType: body.equipmentType ?? existing?.equipmentType ?? null,
    model: body.model ?? existing?.model ?? null,
    serialNumber: body.serialNumber ?? existing?.serialNumber ?? null,
    condition: text(body.condition, text(existing?.condition, 'good')),
    manufactureYear: body.manufactureYear ?? existing?.manufactureYear ?? null,
    originCountry: body.originCountry ?? existing?.originCountry ?? null,
    currentHolder: body.currentHolder ?? existing?.currentHolder ?? null,
    notes: body.notes ?? existing?.notes ?? null,
    quantity: numberValue(body.quantity, numberValue(existing?.quantity, 1)),
    minQuantity: numberValue(body.minQuantity, numberValue(existing?.minQuantity)),
    maintenanceSentAt: body.maintenanceSentAt ?? existing?.maintenanceSentAt ?? null,
    maintenanceReturnedAt: body.maintenanceReturnedAt ?? existing?.maintenanceReturnedAt ?? null,
    maintenanceNotes: body.maintenanceNotes ?? existing?.maintenanceNotes ?? null,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
}

async function route(pathname: string, searchParams: URLSearchParams, method: string, init?: RequestInit): Promise<Response> {
  if (pathname === '/api/healthz' && method === 'GET') return json({ status: 'ok' });

  if (pathname === '/api/auth/setup-status' && method === 'GET') {
    return read((state) => json({ needsSetup: !state.users.some((user) => user.role === 'admin') }));
  }

  if (pathname === '/api/auth/setup' && method === 'POST') {
    const body = readBody(init);
    return mutate(async (state) => {
      if (state.users.some((user) => user.role === 'admin')) return failure(409, 'Admin already exists');
      const username = text(body.username);
      const fullName = text(body.fullName);
      const password = text(body.password);
      if (!username || !fullName || password.length < 8) return failure(400, 'username, password, and fullName are required');
      if (state.users.some((user) => user.username === username)) return failure(409, 'Username already taken');
      const salt = crypto.randomUUID();
      const user = {
        id: nextId(state),
        username,
        fullName,
        role: 'admin' as const,
        passwordHash: await passwordHash(password, salt),
        passwordSalt: salt,
        isActive: true,
        createdAt: now(),
      };
      state.users.push(user);
      state.currentUserId = user.id;
      state.settings.setupCompleted = true;
      state.settings.setupAt = now();
      addAudit(state, publicUser(user), 'create', 'user', user.id);
      return json(publicUser(user));
    });
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    const body = readBody(init);
    return mutate(async (state) => {
      const user = state.users.find((entry) => entry.username === text(body.username) && entry.isActive);
      if (!user || !(await verifyPassword(text(body.password), user.passwordSalt, user.passwordHash))) {
        return failure(401, 'اسم المستخدم أو كلمة المرور غير صحيحة');
      }
      // Upgrade legacy SHA-256 hashes to PBKDF2 on successful login.
      if (!user.passwordHash.startsWith('pbkdf2$')) {
        user.passwordHash = await passwordHash(text(body.password), user.passwordSalt);
      }
      state.currentUserId = user.id;
      return json(publicUser(user));
    });
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    return mutate((state) => {
      state.currentUserId = null;
      return json({ ok: true });
    });
  }

  if (pathname === '/api/auth/me' && method === 'GET') {
    return read((state) => {
      const user = auth(state);
      return user ? json(user) : failure(401, 'Not authenticated');
    });
  }

  const currentUser = await read((state) => auth(state));
  if (!currentUser) return failure(401, 'Not authenticated');

  if (pathname === '/api/categories' && method === 'GET') {
    return read((state) => json(state.categories.map(({ id, name, type }) => ({ id, name, type }))));
  }
  if (pathname === '/api/categories' && method === 'POST') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'ليس لديك صلاحية');
    return mutate((state) => {
      const body = readBody(init);
      const name = text(body.name);
      const category = { id: nextId(state), name, type: text(body.type, 'consumable'), createdAt: now() };
      state.categories.push(category);
      recordOfflineChange(state, 'category', category.id, 'create', { name: category.name, type: category.type });
      addAudit(state, currentUser, 'create', 'category', category.id);
      return json(category);
    });
  }
  const categoryId = idFrom(pathname, 'categories');
  if (categoryId && pathname === `/api/categories/${categoryId}` && method === 'PUT') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'ليس لديك صلاحية');
    return mutate((state) => {
      const category = state.categories.find((entry) => entry.id === categoryId);
      if (!category) return failure(404, 'التصنيف غير موجود');
      const body = readBody(init);
      category.name = text(body.name, category.name);
      category.type = text(body.type, category.type);
      recordOfflineChange(state, 'category', category.id, 'update', { name: category.name, type: category.type });
      addAudit(state, currentUser, 'update', 'category', category.id);
      return json(category);
    });
  }
  if (categoryId && pathname === `/api/categories/${categoryId}` && method === 'DELETE') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'ليس لديك صلاحية');
    return mutate((state) => {
      state.categories = state.categories.filter((entry) => entry.id !== categoryId);
      recordOfflineChange(state, 'category', categoryId, 'delete', {});
      addAudit(state, currentUser, 'delete', 'category', categoryId);
      return json({ ok: true });
    });
  }

  if (pathname === '/api/items' && method === 'GET') {
    return read((state) => {
      let rows = state.items.filter((item) => item.isActive !== false).map((item) => itemWithCategory(state, item));
      const search = text(searchParams.get('search'));
      if (search) rows = rows.filter((item) => `${item.name} ${item.code ?? ''} ${item.location ?? ''} ${item.supplier ?? ''} ${item.batchNumber ?? ''}`.includes(search));
      if (searchParams.get('categoryId')) rows = rows.filter((item) => item.categoryId === Number(searchParams.get('categoryId')));
      if (searchParams.get('belowMin') === 'true') rows = rows.filter((item) => numberValue(item.currentStock) <= numberValue(item.minStock));
      if (searchParams.get('nearExpiry') === 'true') {
        const until = Date.now() + numberValue(state.settings.expiryAlertDays, 30) * 86_400_000;
        rows = rows.filter((item) => item.expiryDate && new Date(String(item.expiryDate)).getTime() <= until);
      }
      const page = paged(sortRows(rows, searchParams.get('sortBy'), searchParams.get('sortDir')), searchParams);
      return json({ items: page.rows, total: page.total, page: page.page, limit: page.limit });
    });
  }
  if (pathname === '/api/items' && method === 'POST') {
    if (!roleAllowed(currentUser, ['admin', 'warehouse_manager'])) return failure(403, 'ليس لديك صلاحية');
    return mutate((state) => {
      const item = itemFromInput(state, readBody(init));
      state.items.push(item);
      recordOfflineChange(state, 'item', Number(item.id), 'create', {
        name: item.name,
        itemType: item.itemType,
        quantity: item.currentStock,
      });
      addAudit(state, currentUser, 'create', 'item', Number(item.id));
      return json(item, 201);
    });
  }
  const itemId = idFrom(pathname, 'items');
  if (itemId && pathname === `/api/items/${itemId}` && method === 'GET') {
    return read((state) => {
      const item = state.items.find((entry) => entry.id === itemId && entry.isActive !== false);
      return item ? json(itemWithCategory(state, item)) : failure(404, 'المادة غير موجودة');
    });
  }
  if (itemId && pathname === `/api/items/${itemId}` && method === 'PUT') {
    if (!roleAllowed(currentUser, ['admin', 'warehouse_manager'])) return failure(403, 'ليس لديك صلاحية');
    return mutate((state) => {
      const index = state.items.findIndex((entry) => entry.id === itemId);
      if (index < 0) return failure(404, 'المادة غير موجودة');
      state.items[index] = itemFromInput(state, readBody(init), state.items[index]);
      addAudit(state, currentUser, 'update', 'item', itemId);
      return json(itemWithCategory(state, state.items[index]));
    });
  }
  if (itemId && pathname === `/api/items/${itemId}` && method === 'DELETE') {
    if (!roleAllowed(currentUser, ['admin', 'warehouse_manager'])) return failure(403, 'ليس لديك صلاحية');
    return mutate((state) => {
      const item = state.items.find((entry) => entry.id === itemId);
      if (!item) return failure(404, 'المادة غير موجودة');
      item.isActive = false;
      item.updatedAt = now();
      addAudit(state, currentUser, 'delete', 'item', itemId);
      return json({ ok: true });
    });
  }
  if (pathname === '/api/items/history' && method === 'GET') {
    const historyItemId = Number(searchParams.get('itemId'));
    return read((state) => {
      const rawItem = state.items.find((item) => numberValue(item.id) === historyItemId && item.isActive !== false);
      if (!rawItem) return failure(404, 'المادة غير موجودة');
      const item = itemWithCategory(state, rawItem);
      const allMovements = state.transactions
        .filter((transaction) => numberValue(transaction.itemId) === historyItemId)
        .map((transaction) => ({
          id: numberValue(transaction.id),
          type: text(transaction.type, 'adjust'),
          quantity: transaction.quantity == null ? null : numberValue(transaction.quantity),
          partyName: text(transaction.partyName, text(transaction.recipientName)) || null,
          documentNumber: text(transaction.documentNumber, `OFF-${transaction.id}`),
          documentDate: text(transaction.transactionDate, text(transaction.createdAt)) || null,
          createdAt: text(transaction.createdAt, now()),
          operatorName: text(transaction.operatorName, text(state.users.find((user) => user.id === numberValue(transaction.createdBy))?.fullName)) || null,
          expiryDate: text(transaction.expiryDate) || null,
          batchNumber: text(transaction.batchNumber) || null,
          reason: text(transaction.reason) || null,
          notes: text(transaction.notes) || null,
          isHistoricalIncomplete: false,
          allocations: [],
        }));
      const typeFilter = text(searchParams.get('type'));
      const from = text(searchParams.get('from'));
      const to = text(searchParams.get('to'));
      const document = text(searchParams.get('document')).toLocaleLowerCase();
      const movements = allMovements.filter((movement) =>
        (!typeFilter || movement.type === typeFilter) &&
        (!from || String(movement.documentDate ?? '').slice(0, 10) >= from) &&
        (!to || String(movement.documentDate ?? '').slice(0, 10) <= to) &&
        (!document || movement.documentNumber.toLocaleLowerCase().includes(document)),
      );
      const page = paged(movements, searchParams);
      return json({
        item: {
          id: historyItemId,
          code: text(item.code) || null,
          name: text(item.name, '—'),
          categoryName: text(item.categoryName) || null,
          itemType: text(item.itemType, 'item'),
          unit: text(item.unit, 'قطعة'),
          currentStock: numberValue(item.currentStock),
          minStock: numberValue(item.minStock),
          expiryDate: text(item.expiryDate) || null,
          location: text(item.location) || null,
          supplier: text(item.supplier) || null,
          notes: text(item.notes) || null,
          isActive: item.isActive !== false,
        },
        batches: item.batchNumber ? [{
          id: historyItemId,
          batchNumber: text(item.batchNumber) || null,
          receivedQuantity: numberValue(item.currentStock),
          remainingQuantity: numberValue(item.currentStock),
          expiryDate: text(item.expiryDate) || null,
          deliveryNoteNumber: null,
          deliveryNoteDate: null,
        }] : [],
        movements: page.rows,
        total: page.total,
        page: page.page,
        limit: page.limit,
      });
    });
  }
  if (pathname === '/api/items/fefo-preview' && method === 'GET') {
    return read((state) => {
      const item = state.items.find((entry) => entry.id === Number(searchParams.get('itemId')));
      return json({ itemId: item?.id ?? null, requestedQuantity: Number(searchParams.get('quantity') ?? 0), allocations: [], expiredBatches: [] });
    });
  }
  if (pathname === '/api/items/bulk-import/preview' && method === 'POST') {
    return read((state) => {
      const body = readBody(init);
      const rawItems = Array.isArray(body)
        ? body
        : Array.isArray(body.items) ? body.items : [];
      const rawBatches = !Array.isArray(body) && Array.isArray(body.openingBatches)
        ? body.openingBatches
        : [];
      const mode = searchParams.get('mode') === 'upsert' ? 'upsert' as const : 'insert' as const;
      const existingByCode = new Map(
        state.items
          .filter((item) => item.isActive !== false && text(item.code))
          .map((item) => [text(item.code), {
            id: numberValue(item.id),
            code: text(item.code) || null,
            name: text(item.name),
            requiresExpiryTracking: Boolean(item.requiresExpiryTracking),
            requiresBatchTracking: Boolean(item.requiresBatchTracking),
          }]),
      );
      const itemRows = validateInventoryImportRows(
        rawItems.filter((entry: unknown): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'),
        {
          mode,
          categories: createCategoryLookup(state.categories),
          existingByCode,
          units: createUnitLookup(DEFAULT_INVENTORY_UNITS),
        },
      );
      const projectedByCode = new Map(existingByCode);
      for (const decision of itemRows) {
        if (decision.state !== 'error' && decision.action === 'create-item' && decision.row.code) {
          projectedByCode.set(decision.row.code, {
            id: -decision.row.rowNumber,
            code: decision.row.code,
            name: decision.row.name,
            requiresExpiryTracking: false,
            requiresBatchTracking: false,
          });
        }
      }
      const openingBatchRows = validateInventoryOpeningBatchRows(
        rawBatches.filter((entry: unknown): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'),
        { existingByCode: projectedByCode },
      );
      const all = [...itemRows, ...openingBatchRows];
      const errors = all.filter((decision) => decision.state === 'error');
      const warnings = all.filter((decision) => decision.warnings.length > 0);
      return json({
        valid: errors.length === 0 && all.some((decision) => decision.state !== 'empty'),
        summary: {
          totalRows: all.filter((decision) => decision.state !== 'empty').length,
          validRows: all.filter((decision) => decision.state === 'valid' || decision.state === 'warning').length,
          warningRows: warnings.length,
          errorRows: errors.length,
          newItems: itemRows.filter((decision) => decision.action === 'create-item').length,
          updatedItems: itemRows.filter((decision) => decision.action === 'update-item').length,
          openingBatches: openingBatchRows.filter((decision) => decision.action === 'create-opening-batch').length +
            itemRows.filter((decision) => decision.createsOpeningBatch).length,
        },
        itemRows: itemRows.map((decision) => ({
          rowNumber: decision.row.rowNumber,
          state: decision.state,
          action: decision.action,
          row: decision.row,
          errors: decision.errors,
          warnings: decision.warnings,
        })),
        openingBatchRows: openingBatchRows.map((decision) => ({
          rowNumber: decision.row.rowNumber,
          state: decision.state,
          action: decision.action,
          row: decision.row,
          errors: decision.errors,
          warnings: decision.warnings,
        })),
      });
    });
  }
  if (pathname === '/api/items/bulk-import' && method === 'POST') {
    if (!roleAllowed(currentUser, ['admin', 'warehouse_manager'])) return failure(403, 'ليس لديك صلاحية');
    return mutate((state) => {
      const body = readBody(init);
      const input = Array.isArray(body) ? body : Array.isArray((body as { items?: unknown }).items) ? (body as { items: unknown[] }).items : [];
      const openingInput = !Array.isArray(body) && Array.isArray((body as { openingBatches?: unknown }).openingBatches)
        ? (body as { openingBatches: unknown[] }).openingBatches
        : [];
      const mode = searchParams.get('mode') === 'upsert' ? 'upsert' as const : 'insert' as const;
      const categories = createCategoryLookup(state.categories);
      const existingByCode = new Map(
        state.items
          .filter((item) => item.isActive !== false && text(item.code))
          .map((item) => [text(item.code), {
            id: numberValue(item.id),
            code: text(item.code) || null,
            name: text(item.name),
            requiresExpiryTracking: Boolean(item.requiresExpiryTracking),
            requiresBatchTracking: Boolean(item.requiresBatchTracking),
          }]),
      );
      const decisions = validateInventoryImportRows(
        input.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'),
        { mode, categories, existingByCode, units: createUnitLookup(DEFAULT_INVENTORY_UNITS) },
      );
      const projectedByCode = new Map(existingByCode);
      for (const decision of decisions) {
        if (decision.state !== 'error' && decision.action === 'create-item' && decision.row.code) {
          projectedByCode.set(decision.row.code, {
            id: -decision.row.rowNumber,
            code: decision.row.code,
            name: decision.row.name,
            requiresExpiryTracking: false,
            requiresBatchTracking: false,
          });
        }
      }
      const batchDecisions = validateInventoryOpeningBatchRows(
        openingInput.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'),
        { existingByCode: projectedByCode },
      );
      const preflightErrors = [...decisions, ...batchDecisions]
        .filter((decision) => decision.state === 'error');
      if (preflightErrors.length > 0) {
        return json({
          error: 'لا يمكن تنفيذ الاستيراد قبل معالجة الأخطاء الحرجة',
          valid: false,
          errors: preflightErrors.map((decision) => ({
            row: decision.row.rowNumber,
            name: decision.row.code || `صف ${decision.row.rowNumber}`,
            error: decision.errors.map((issue) => issue.message).join('؛ '),
          })),
        }, 422);
      }
      let created = 0;
      let updated = 0;
      let openingBatches = 0;
      const errors: Array<{ row: number; name: string; error: string }> = [];
      const warnings: Array<{ row: number; name: string; warning: string }> = [];
      for (const decision of decisions) {
        const row = decision.row;
        const name = row.name || `صف ${row.rowNumber}`;
        if (decision.state === 'empty') continue;
        for (const warning of decision.warnings) {
          warnings.push({ row: row.rowNumber, name, warning: warning.message });
        }
        if (decision.errors.length) {
          errors.push({
            row: row.rowNumber,
            name,
            error: decision.errors.map((issue) => issue.message).join('؛ '),
          });
          continue;
        }
        const categoryId = row.categoryName ? categories.get(normalizeHeader(row.categoryName)) ?? null : null;
        const existing = decision.existingItem
          ? state.items.find((item) => numberValue(item.id) === decision.existingItem?.id)
          : undefined;
        const value: Record<string, unknown> = {
          code: row.code,
          name: row.name,
          categoryId,
          itemType: 'item',
          unit: row.unit,
          minStock: row.minStock ?? 0,
          location: row.location,
          notes: row.notes,
        };
        if (existing) {
          value.currentStock = existing.currentStock;
          value.expiryDate = existing.expiryDate;
          value.batchNumber = existing.batchNumber;
          value.supplier = existing.supplier;
        } else {
          value.currentStock = row.currentStock ?? 0;
          value.expiryDate = row.expiryDate;
          value.batchNumber = row.batchNumber;
          value.supplier = row.supplier;
        }
        const item = itemFromInput(state, value, existing);
        if (existing) {
          Object.assign(existing, item);
          updated += 1;
        } else {
          state.items.push(item);
          created += 1;
          if ((row.currentStock ?? 0) > 0) {
            const batch = {
              id: nextId(state),
              itemId: item.id,
              batchNumber: row.batchNumber,
              receivedQuantity: row.currentStock,
              remainingQuantity: row.currentStock,
              expiryDate: row.expiryDate,
              supplier: row.supplier,
              deliveryNoteNumber: `افتتاحي-${item.id}`,
              deliveryNoteDate: now().slice(0, 10),
            };
            state.inventoryBatches.push(batch);
            recordOfflineChange(state, 'inventory_batch', Number(batch.id), 'create', {
              ...batch,
              itemGlobalId: state.entityIds.find((entry) => entry.entityType === 'item' && entry.localId === Number(item.id))?.globalId ?? null,
            });
          }
        }
        recordOfflineChange(state, 'item', Number(item.id), existing ? 'update' : 'create', {
          name: item.name,
          quantity: existing ? existing.currentStock : item.currentStock,
        });
      }
      for (const decision of batchDecisions) {
        if (decision.state === 'empty') continue;
        const item = state.items.find((entry) => text(entry.code) === decision.row.code);
        if (!item) return failure(400, `المادة ذات الرمز ${decision.row.code} غير موجودة`);
        const quantity = numberValue(decision.row.quantity);
        const batch = {
          id: nextId(state),
          itemId: item.id,
          batchNumber: decision.row.batchNumber,
          receivedQuantity: quantity,
          remainingQuantity: quantity,
          expiryDate: decision.row.expiryDate,
          supplier: decision.row.supplier,
          deliveryNoteNumber: decision.row.deliveryNoteNumber ?? `استيراد-دفعة-${item.id}-${decision.row.rowNumber}`,
          deliveryNoteDate: decision.row.deliveryNoteDate ?? now().slice(0, 10),
        };
        item.currentStock = numberValue(item.currentStock) + quantity;
        state.inventoryBatches.push(batch);
        const transaction = {
          id: nextId(state),
          type: 'in',
          documentNumber: batch.deliveryNoteNumber,
          transactionDate: batch.deliveryNoteDate,
          itemId: item.id,
          quantity,
          notes: null,
          createdBy: currentUser.id,
          createdAt: now(),
        };
        state.transactions.unshift(transaction);
        recordOfflineChange(state, 'inventory_batch', Number(batch.id), 'create', {
          ...batch,
          itemGlobalId: state.entityIds.find((entry) => entry.entityType === 'item' && entry.localId === Number(item.id))?.globalId ?? null,
        });
        recordOfflineChange(state, 'transaction', Number(transaction.id), 'create', {
          type: transaction.type,
          documentNumber: transaction.documentNumber,
          itemId: transaction.itemId,
          quantity: transaction.quantity,
        });
        addAudit(state, currentUser, 'create', 'transaction', Number(transaction.id));
        openingBatches += 1;
      }
      return json({ created, updated, openingBatches, inserted: created, skipped: errors.length, errors, warnings });
    });
  }

  if (pathname === '/api/equipment' && method === 'GET') {
    return read((state) => {
      let rows = [...state.equipment];
      const search = text(searchParams.get('search'));
      if (search) rows = rows.filter((item) => `${item.name} ${item.model ?? ''} ${item.serialNumber ?? ''}`.includes(search));
      if (searchParams.get('condition')) rows = rows.filter((item) => item.condition === searchParams.get('condition'));
      return json({ ...paged(sortRows(rows, searchParams.get('sortBy'), searchParams.get('sortDir')), searchParams), equipment: paged(sortRows(rows, searchParams.get('sortBy'), searchParams.get('sortDir')), searchParams).rows });
    });
  }
  if (pathname === '/api/equipment' && method === 'POST') {
    if (!roleAllowed(currentUser, ['admin', 'warehouse_manager'])) return failure(403, 'ليس لديك صلاحية');
    return mutate((state) => {
      const equipment = equipmentFromInput(state, readBody(init));
      state.equipment.push(equipment);
      recordOfflineChange(state, 'equipment', Number(equipment.id), 'create', {
        name: equipment.name,
        serialNumber: equipment.serialNumber,
        quantity: equipment.quantity,
      });
      addAudit(state, currentUser, 'create', 'equipment', Number(equipment.id));
      return json(equipment, 201);
    });
  }
  const equipmentId = idFrom(pathname, 'equipment');
  if (equipmentId && pathname === `/api/equipment/${equipmentId}` && method === 'GET') {
    return read((state) => {
      const equipment = state.equipment.find((entry) => entry.id === equipmentId);
      return equipment ? json(equipment) : failure(404, 'التجهيز غير موجود');
    });
  }
  if (equipmentId && pathname === `/api/equipment/${equipmentId}` && method === 'PUT') {
    if (!roleAllowed(currentUser, ['admin', 'warehouse_manager'])) return failure(403, 'ليس لديك صلاحية');
    return mutate((state) => {
      const index = state.equipment.findIndex((entry) => entry.id === equipmentId);
      if (index < 0) return failure(404, 'التجهيز غير موجود');
      const body = readBody(init);
      const existing = state.equipment[index];
      if (body.quantity !== undefined && Number(body.quantity) !== numberValue(existing.quantity)) {
        return failure(409, 'لا يمكن تعديل كمية التجهيز مباشرة — استخدم تسوية الجرد (الرصيد يُدار عبر سندات الحركة)' );
      }
      state.equipment[index] = equipmentFromInput(state, body, existing);
      addAudit(state, currentUser, 'update', 'equipment', equipmentId);
      return json(state.equipment[index]);
    });
  }
  if (equipmentId && pathname === `/api/equipment/${equipmentId}` && method === 'DELETE') {
    if (!roleAllowed(currentUser, ['admin', 'warehouse_manager'])) return failure(403, 'ليس لديك صلاحية');
    return mutate((state) => {
      state.equipment = state.equipment.filter((entry) => entry.id !== equipmentId);
      addAudit(state, currentUser, 'delete', 'equipment', equipmentId);
      return json({ ok: true });
    });
  }
  if (pathname === '/api/equipment/bulk-import' && method === 'POST') {
    if (!roleAllowed(currentUser, ['admin', 'warehouse_manager'])) return failure(403, 'ليس لديك صلاحية');
    return mutate((state) => {
      const body = readBody(init);
      const input = Array.isArray(body) ? body : Array.isArray((body as { equipment?: unknown }).equipment) ? (body as { equipment: unknown[] }).equipment : [];
      let created = 0;
      let updated = 0;
      const errors: Array<{ row: number; name: string; error: string }> = [];
      for (const [index, entry] of input.entries()) {
        const value = (entry ?? {}) as Record<string, unknown>;
        const name = text(value.name);
        if (!name) {
          errors.push({ row: index + 2, name: '', error: 'اسم التجهيز مطلوب' });
          continue;
        }
        const serial = text(value.serialNumber);
        const existing = serial ? state.equipment.find((item) => item.serialNumber === serial) : undefined;
        const equipment = equipmentFromInput(state, value, existing);
        if (existing) {
          Object.assign(existing, equipment);
          updated += 1;
        } else {
          state.equipment.push(equipment);
          created += 1;
        }
        recordOfflineChange(state, 'equipment', Number(equipment.id), existing ? 'update' : 'create', { name: equipment.name, serialNumber: equipment.serialNumber });
      }
      return json({ created, updated, inserted: created, skipped: errors.length, errors });
    });
  }

  if (pathname === '/api/recipients' && method === 'GET') {
    return read((state) => json(state.recipients.filter((entry) => searchParams.get('includeInactive') === 'true' || entry.isActive !== false)));
  }
  if (pathname === '/api/recipients' && method === 'POST') {
    if (!roleAllowed(currentUser, ['admin', 'warehouse_manager'])) return failure(403, 'ليس لديك صلاحية');
    return mutate((state) => {
      const body = readBody(init);
      const recipient = { id: nextId(state), name: text(body.name), notes: body.notes ?? null, isActive: true, createdAt: now() };
      state.recipients.push(recipient);
      addAudit(state, currentUser, 'create', 'recipient', recipient.id);
      return json(recipient);
    });
  }
  const recipientId = idFrom(pathname, 'recipients');
  if (recipientId && pathname === `/api/recipients/${recipientId}` && method === 'PUT') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'ليس لديك صلاحية');
    return mutate((state) => {
      const recipient = state.recipients.find((entry) => entry.id === recipientId);
      if (!recipient) return failure(404, 'الجهة غير موجودة');
      const body = readBody(init);
      Object.assign(recipient, { name: text(body.name, text(recipient.name)), notes: body.notes ?? recipient.notes });
      return json(recipient);
    });
  }
  if (recipientId && pathname === `/api/recipients/${recipientId}/toggle` && method === 'PATCH') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'ليس لديك صلاحية');
    return mutate((state) => {
      const recipient = state.recipients.find((entry) => entry.id === recipientId);
      if (!recipient) return failure(404, 'الجهة غير موجودة');
      recipient.isActive = !recipient.isActive;
      return json(recipient);
    });
  }

  if (pathname === '/api/exit-reasons' && method === 'GET') {
    return read((state) => json(state.exitReasons.filter((entry) => searchParams.get('includeInactive') === 'true' || entry.isActive !== false)));
  }
  if (pathname === '/api/exit-reasons' && method === 'POST') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'ليس لديك صلاحية');
    return mutate((state) => {
      const body = readBody(init);
      const reason = { id: nextId(state), name: text(body.name), isSystem: false, isActive: true, createdAt: now() };
      state.exitReasons.push(reason);
      return json(reason);
    });
  }
  const reasonId = idFrom(pathname, 'exit-reasons');
  if (reasonId && pathname === `/api/exit-reasons/${reasonId}` && method === 'PUT') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'ليس لديك صلاحية');
    return mutate((state) => {
      const reason = state.exitReasons.find((entry) => entry.id === reasonId);
      if (!reason) return failure(404, 'سبب الإخراج غير موجود');
      reason.name = text(readBody(init).name, text(reason.name));
      return json(reason);
    });
  }
  if (reasonId && pathname === `/api/exit-reasons/${reasonId}/toggle` && method === 'PATCH') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'ليس لديك صلاحية');
    return mutate((state) => {
      const reason = state.exitReasons.find((entry) => entry.id === reasonId);
      if (!reason) return failure(404, 'سبب الإخراج غير موجود');
      if (reason.isSystem) return failure(400, 'لا يمكن تعطيل الأسباب الافتراضية للنظام');
      reason.isActive = !reason.isActive;
      return json(reason);
    });
  }

  if (pathname === '/api/transactions' && method === 'GET') {
    return read((state) => {
      let rows = [...state.transactions];
      const search = text(searchParams.get('search'));
      if (search) rows = rows.filter((transaction) => JSON.stringify(transaction).includes(search));
      if (searchParams.get('type') && searchParams.get('type') !== 'all') rows = rows.filter((transaction) => transaction.type === searchParams.get('type'));
      const page = paged(rows, searchParams);
      return json({ transactions: page.rows, total: page.total, page: page.page, limit: page.limit });
    });
  }
  if (pathname.startsWith('/api/transactions/') && method === 'POST') {
    if (!roleAllowed(currentUser, ['admin', 'warehouse_manager'])) return failure(403, 'ليس لديك صلاحية');
    return mutate((state) => {
      const body = readBody(init);
      const requestedType = pathname.split('/').pop() ?? 'adjust';
      const type = requestedType.replace(/-/g, '_');
      const custodyEquipment = type === 'custody_out'
        ? state.equipment.find((entry) => entry.id === Number(body.equipmentId))
        : undefined;
      const custodyReturn = type === 'custody_return'
        ? state.personalCustodies.find((entry) => numberValue(entry.id) === numberValue(body.custodyId))
        : undefined;
      if (type === 'custody_out') {
        const requestedQuantity = numberValue(body.quantity, 1);
        if (!custodyEquipment) return failure(404, 'التجهيز غير موجود');
        if (requestedQuantity < 1 || requestedQuantity > numberValue(custodyEquipment.quantity, 1)) {
          return failure(400, 'كمية العهدة غير صالحة');
        }
      }
      if (type === 'custody_return') {
        const requestedQuantity = numberValue(body.quantity);
        if (!custodyReturn) return failure(404, 'العهدة غير موجودة');
        if (requestedQuantity < 1 || requestedQuantity > numberValue(custodyReturn.quantity) - numberValue(custodyReturn.returnedQuantity)) {
          return failure(400, 'كمية الإعادة تتجاوز المتبقي في العهدة');
        }
      }
      const transaction = {
        id: nextId(state),
        type,
        documentNumber: body.documentNumber ?? `OFF-${Date.now()}`,
        transactionDate: body.transactionDate ?? now().slice(0, 10),
        notes: body.notes ?? null,
        itemId: body.itemId ?? null,
        equipmentId: body.equipmentId ?? null,
        quantity: numberValue(body.quantity, 0),
        createdBy: currentUser.id,
        createdAt: now(),
        ...body,
      };
      if (type === 'adjust') {
        const newStock = numberValue(body.newStock);
        if (body.itemType === 'equipment') {
          const equipment = state.equipment.find((entry) => entry.id === Number(body.equipmentId));
          if (!equipment) return failure(404, 'التجهيز غير موجود');
          const previousStock = numberValue(equipment.quantity, 0);
          if (newStock < previousStock && newStock < 0) return failure(400, 'الرصيد الجديد يجب أن يكون صفرًا أو أكبر');
          equipment.quantity = newStock;
          transaction.quantity = Math.abs(newStock - previousStock);
          transaction.details = { previousStock, newStock, delta: newStock - previousStock, deltaType: newStock > previousStock ? 'increase' : 'decrease', openCustody: 0, availableBefore: previousStock, equipmentNameSnap: equipment.name, equipmentModelSnap: equipment.model ?? null, equipmentSerialSnap: equipment.serialNumber ?? null, equipmentConditionSnap: equipment.condition ?? null };
        } else {
          const item = state.items.find((entry) => entry.id === Number(body.itemId));
          if (!item) return failure(404, 'المادة غير موجودة');
          const previousStock = numberValue(item.currentStock, 0);
          item.currentStock = newStock;
          transaction.quantity = Math.abs(newStock - previousStock);
          transaction.details = { previousStock, newStock, delta: newStock - previousStock, deltaType: newStock > previousStock ? 'increase' : 'decrease' };
        }
      }
      const target = state.items.find((item) => item.id === Number(body.itemId));
      if (target && ['in'].includes(type)) target.currentStock = numberValue(target.currentStock) + numberValue(body.quantity);
      if (target && ['out', 'damage', 'central-return', 'central_return'].includes(type)) {
        target.currentStock = Math.max(0, numberValue(target.currentStock) - numberValue(body.quantity));
      }
      state.transactions.unshift(transaction);
      const transactionIdentity = recordOfflineChange(
        state,
        'transaction',
        Number(transaction.id),
        'create',
        {
          type: transaction.type,
          documentNumber: transaction.documentNumber,
          itemId: transaction.itemId,
          equipmentId: transaction.equipmentId,
          quantity: transaction.quantity,
        },
      );
      Object.assign(transaction, {
        operationId: transactionIdentity.operationId,
        globalId: transactionIdentity.globalId,
        originNodeId: state.nodeIdentity.nodeId,
        originSequence: state.nodeIdentity.originSequence,
        documentNumberScope: `offline:${type}`,
      });

      // Equipment custody is a separate lifecycle record. The online service
      // creates it in the same transaction as the movement; doing only the
      // generic transaction here made Android custody deliveries disappear
      // from the custody report.
      if (type === 'custody_out') {
        const equipment = custodyEquipment;
        const quantity = numberValue(body.quantity, 1);
        if (!equipment) return failure(404, 'التجهيز غير موجود');
        const custody = {
          id: nextId(state),
          equipmentId: equipment.id,
          sourceTransactionId: transaction.id,
          recipientId: body.recipientId ?? null,
          holderNameSnap: text(body.holderName, text(body.recipientPerson)),
          deliveryNoteNumber: text(body.custodyNoteNumber, text(body.deliveryNoteNumber)),
          deliveryDate: text(body.custodyDate, text(body.deliveryNoteDate, text(body.documentDate, now().slice(0, 10)))),
          quantity,
          returnedQuantity: 0,
          location: text(body.custodyLocation),
          status: 'open',
          createdBy: currentUser.id,
          createdAt: now(),
          updatedAt: now(),
        };
        state.personalCustodies.unshift(custody);
        recordOfflineChange(state, 'personal_custody', custody.id, 'create', {
          equipmentId: custody.equipmentId,
          sourceTransactionId: custody.sourceTransactionId,
          quantity: custody.quantity,
          holderNameSnap: custody.holderNameSnap,
          deliveryNoteNumber: custody.deliveryNoteNumber,
          deliveryDate: custody.deliveryDate,
          location: custody.location,
        });
        if (quantity === 1) equipment.currentHolder = custody.holderNameSnap;
      }

      if (type === 'custody_return') {
        const custodyId = numberValue(body.custodyId);
        const custody = custodyReturn;
        if (!custody) return failure(404, 'العهدة غير موجودة');
        const quantity = numberValue(body.quantity);
        const outstanding = numberValue(custody.quantity) - numberValue(custody.returnedQuantity);
        if (quantity < 1 || quantity > outstanding) return failure(400, `كمية الإعادة تتجاوز المتبقي في العهدة (${outstanding})`);
        const condition = text(body.returnCondition, 'good');
        const returnRecord = {
          id: nextId(state),
          custodyId,
          transactionId: transaction.id,
          quantity,
          returnDate: text(body.documentDate, now().slice(0, 10)),
          documentNumber: transaction.documentNumber,
          condition,
          returnedToLocation: text(body.returnedToLocation, text(body.custodyLocation)),
          inspectionNotes: body.inspectionNotes ?? null,
          createdBy: currentUser.id,
          createdAt: now(),
        };
        state.custodyReturns.unshift(returnRecord);
        recordOfflineChange(state, 'custody_return', returnRecord.id, 'create', {
          custodyId,
          transactionId: transaction.id,
          quantity,
          condition,
        });
        const equipment = state.equipment.find((entry) => entry.id === numberValue(custody.equipmentId));
        const nextReturned = numberValue(custody.returnedQuantity) + quantity;
        custody.returnedQuantity = nextReturned;
        custody.status = nextReturned === numberValue(custody.quantity)
          ? (condition === 'good' ? 'returned' : condition === 'damaged' ? 'damaged' : 'closed')
          : 'partially_returned';
        custody.updatedAt = now();
        recordOfflineChange(state, 'personal_custody', numberValue(custody.id), 'update', {
          returnedQuantity: custody.returnedQuantity,
          status: custody.status,
        });
        if (equipment && condition !== 'good') {
          equipment.quantity = Math.max(0, numberValue(equipment.quantity, 1) - quantity);
          equipment.updatedAt = now();
        }
      }
      addAudit(state, currentUser, 'create', 'transaction', transaction.id);
      return json(transaction, 201);
    });
  }
  const transactionId = idFrom(pathname, 'transactions');
  if (transactionId && pathname === `/api/transactions/${transactionId}` && method === 'GET') {
    return read((state) => {
      const transaction = state.transactions.find((entry) => entry.id === transactionId);
      return transaction ? json(transaction) : failure(404, 'السند غير موجود');
    });
  }
  if (transactionId && pathname === `/api/transactions/${transactionId}/print` && method === 'GET') {
    return read((state) => {
      const transaction = state.transactions.find((entry) => entry.id === transactionId);
      if (!transaction) return failure(404, 'السند غير موجود');
      const item = state.items.find((entry) => entry.id === Number(transaction.itemId));
      const equipment = state.equipment.find((entry) => entry.id === Number(transaction.equipmentId));
      return json({
        transaction: {
          ...transaction,
          itemName: item?.name ?? null,
          itemUnit: item?.unit ?? null,
          itemType: transaction.itemId != null ? 'item' : 'equipment',
          equipmentName: equipment?.name ?? null,
          organizationName: state.settings.orgName,
        },
        organizationName: state.settings.orgName,
        orgSubtitle: state.settings.orgSubtitle,
        printedAt: now(),
      });
    });
  }

  if (pathname === '/api/custodies' && method === 'GET') {
    return read((state) => {
      const status = text(searchParams.get('status'));
      const search = text(searchParams.get('search')).toLocaleLowerCase();
      const rows = state.personalCustodies
        .map((raw) => {
          const equipment = state.equipment.find((entry) => numberValue(entry.id) === numberValue(raw.equipmentId));
          const quantity = numberValue(raw.quantity);
          const returnedQuantity = numberValue(raw.returnedQuantity);
          return {
            id: numberValue(raw.id),
            equipmentId: numberValue(raw.equipmentId),
            equipmentName: text(raw.equipmentName, text(equipment?.name, '—')),
            serialNumber: text(raw.serialNumber, text(equipment?.serialNumber)) || null,
            quantity,
            returnedQuantity,
            outstandingQuantity: Math.max(0, quantity - returnedQuantity),
            recipientId: raw.recipientId ?? null,
            holderName: text(raw.holderName, text(raw.holderNameSnap, '—')),
            deliveryNoteNumber: text(raw.deliveryNoteNumber, '—'),
            deliveryDate: text(raw.deliveryDate, text(raw.custodyDate, now().slice(0, 10))),
            location: text(raw.location, text(raw.custodyLocation, '—')),
            status: text(raw.status, returnedQuantity >= quantity ? 'returned' : 'open'),
          };
        })
        .filter((row) => !status || row.status === status)
        .filter((row) => !search || `${row.equipmentName} ${row.serialNumber ?? ''} ${row.holderName} ${row.deliveryNoteNumber}`.toLocaleLowerCase().includes(search));
      return json(rows);
    });
  }
  const custodyId = idFrom(pathname, 'custodies');
  if (custodyId && pathname === `/api/custodies/${custodyId}` && method === 'GET') {
    return read((state) => {
      const raw = state.personalCustodies.find((entry) => numberValue(entry.id) === custodyId);
      const equipment = raw && state.equipment.find((entry) => numberValue(entry.id) === numberValue(raw.equipmentId));
      if (!raw || !equipment) return failure(404, 'العهدة غير موجودة');
      const quantity = numberValue(raw.quantity);
      const returnedQuantity = numberValue(raw.returnedQuantity);
      const outstandingQuantity = Math.max(0, quantity - returnedQuantity);
      const returns: Array<Record<string, unknown>> = state.custodyReturns
        .filter((entry) => numberValue(entry.custodyId) === custodyId)
        .sort((a, b) => String(a.returnDate ?? '').localeCompare(String(b.returnDate ?? '')))
        .map((entry) => ({ ...entry, operatorName: state.users.find((user) => user.id === numberValue(entry.createdBy))?.fullName ?? null }));
      const source = state.transactions.find((entry) => numberValue(entry.id) === numberValue(raw.sourceTransactionId));
      const deliveryDate = new Date(`${text(raw.deliveryDate, now().slice(0, 10))}T00:00:00Z`);
      const endDate = outstandingQuantity > 0 ? new Date() : new Date(`${String(returns.at(-1)?.returnDate ?? raw.deliveryDate)}T00:00:00Z`);
      const daysHeld = Math.max(0, Math.floor((endDate.getTime() - deliveryDate.getTime()) / 86_400_000));
      let returnedSoFar = 0;
      const events = [
        {
          id: `transaction-${source?.id ?? raw.id}`,
          kind: 'created',
          label: 'إنشاء العهدة وتسليم التجهيز',
          date: source?.transactionDate ?? raw.deliveryDate,
          quantity,
          documentNumber: raw.deliveryNoteNumber,
          location: raw.location,
          condition: null,
          notes: source?.notes ?? null,
          operatorName: state.users.find((user) => user.id === numberValue(source?.createdBy))?.fullName ?? null,
        },
        ...returns.map((entry) => {
          returnedSoFar += numberValue(entry.quantity);
          return {
            id: `return-${entry.id}`,
            kind: entry.condition === 'damaged' ? 'damaged' : 'returned',
            label: returnedSoFar >= quantity ? 'إعادة كاملة' : 'إعادة جزئية',
            date: entry.returnDate,
            quantity: numberValue(entry.quantity),
            documentNumber: entry.documentNumber,
            location: entry.returnedToLocation,
            condition: entry.condition,
            notes: entry.inspectionNotes,
            operatorName: entry.operatorName,
          };
        }),
      ];
      return json({
        custody: {
          ...raw,
          id: custodyId,
          holderName: text(raw.holderName, text(raw.holderNameSnap, '—')),
          recipientName: null,
          equipmentName: equipment.name,
          quantity,
          returnedQuantity,
          outstandingQuantity,
          deliveryNoteNumber: raw.deliveryNoteNumber,
          deliveryDate: raw.deliveryDate,
          location: raw.location,
          status: text(raw.status, 'open'),
          isOverdue: outstandingQuantity > 0 && daysHeld > 30,
          daysHeld,
        },
        equipment: { id: equipment.id, name: equipment.name, equipmentType: equipment.equipmentType ?? null, model: equipment.model ?? null, serialNumber: equipment.serialNumber ?? null },
        returns,
        events,
      });
    });
  }

  if (pathname.match(/^\/api\/equipment\/\d+\/history$/) && method === 'GET') {
    const historyEquipmentId = Number(pathname.split('/')[3]);
    return read((state) => {
      const rawEquipment = state.equipment.find((entry) => numberValue(entry.id) === historyEquipmentId);
      if (!rawEquipment) return failure(404, 'التجهيز غير موجود');
      const equipmentCustodies = state.personalCustodies.filter((entry) => numberValue(entry.equipmentId) === historyEquipmentId);
      const typeFilter = text(searchParams.get('type'));
      const from = text(searchParams.get('from'));
      const to = text(searchParams.get('to'));
      const document = text(searchParams.get('document')).toLocaleLowerCase();
      const movements = state.transactions
        .filter((transaction) => numberValue(transaction.equipmentId) === historyEquipmentId)
        .map((transaction) => ({
          id: numberValue(transaction.id),
          type: text(transaction.type, 'adjust'),
          quantity: transaction.quantity == null ? null : numberValue(transaction.quantity),
          partyName: text(transaction.partyName) || null,
          holderName: text(transaction.holderName) || null,
          documentNumber: text(transaction.documentNumber, `OFF-${transaction.id}`),
          documentDate: text(transaction.transactionDate, text(transaction.createdAt)) || null,
          custodyNoteNumber: text(transaction.custodyNoteNumber) || null,
          custodyDate: text(transaction.custodyDate) || null,
          custodyLocation: text(transaction.custodyLocation) || null,
          reason: text(transaction.reason) || null,
          notes: text(transaction.notes) || null,
          createdAt: text(transaction.createdAt, now()),
          operatorName: text(transaction.operatorName, text(state.users.find((user) => user.id === numberValue(transaction.createdBy))?.fullName)) || null,
        }))
        .filter((movement) =>
          (!typeFilter || movement.type === typeFilter) &&
          (!from || String(movement.documentDate ?? '').slice(0, 10) >= from) &&
          (!to || String(movement.documentDate ?? '').slice(0, 10) <= to) &&
          (!document || movement.documentNumber.toLocaleLowerCase().includes(document)),
        );
      const quantity = numberValue(rawEquipment.quantity, 1);
      const custodyRows = equipmentCustodies.map((custody) => {
        const total = numberValue(custody.quantity);
        const returned = numberValue(custody.returnedQuantity);
        return {
          id: numberValue(custody.id),
          holderName: text(custody.holderName, text(custody.holderNameSnap, '—')),
          recipientName: text(custody.recipientName) || null,
          quantity: total,
          returnedQuantity: returned,
          outstandingQuantity: Math.max(0, total - returned),
          deliveryNoteNumber: text(custody.deliveryNoteNumber, '—'),
          deliveryDate: text(custody.deliveryDate, text(custody.custodyDate)),
          location: text(custody.location, '—'),
          status: text(custody.status, 'open'),
        };
      });
      return json({
        equipment: {
          ...rawEquipment,
          id: historyEquipmentId,
          name: text(rawEquipment.name, '—'),
          equipmentType: text(rawEquipment.equipmentType) || null,
          model: text(rawEquipment.model) || null,
          serialNumber: text(rawEquipment.serialNumber) || null,
          condition: text(rawEquipment.condition, 'good'),
          quantity,
          minQuantity: numberValue(rawEquipment.minQuantity),
          custodyQuantity: custodyRows.reduce((sum, row) => sum + row.outstandingQuantity, 0),
          availableQuantity: Math.max(0, quantity - custodyRows.reduce((sum, row) => sum + row.outstandingQuantity, 0)),
        },
        custodies: custodyRows,
        movements,
        total: movements.length,
      });
    });
  }

  if (pathname === '/api/dashboard/stats' && method === 'GET') {
    return read((state) => {
      const activeItems = state.items.filter((item) => item.isActive !== false);
      const today = new Date();
      const month = today.getMonth();
      const year = today.getFullYear();
      const prev = new Date(year, month - 1, 1);
      const within = (value: unknown, start: Date, end: Date) => {
        const date = new Date(String(value));
        return date >= start && date < end;
      };
      const belowMin = activeItems.filter((item) => numberValue(item.minStock) > 0 && numberValue(item.currentStock) < numberValue(item.minStock)).length;
      const zeroStock = activeItems.filter((item) => numberValue(item.currentStock) === 0).length;
      const expiryDays = numberValue(state.settings.expiryAlertDays, 30);
      const expiryLimit = Date.now() + expiryDays * 86_400_000;
      const nearExpiry = activeItems.filter((item) => item.expiryDate && new Date(String(item.expiryDate)).getTime() > Date.now() && new Date(String(item.expiryDate)).getTime() <= expiryLimit).length;
      const expired = activeItems.filter((item) => item.expiryDate && new Date(String(item.expiryDate)).getTime() <= Date.now()).length;
      const currentStart = new Date(year, month, 1);
      const nextStart = new Date(year, month + 1, 1);
      const previousStart = new Date(prev.getFullYear(), prev.getMonth(), 1);
      return json({
        totalItems: activeItems.length,
        totalEquipment: state.equipment.length,
        belowMinCount: belowMin,
        zeroStockCount: zeroStock,
        nearExpiryCount: nearExpiry,
        expiredCount: expired,
        equipmentAlertCount: state.equipment.filter((item) => ['maintenance', 'needs_inspection', 'broken'].includes(String(item.condition))).length,
        monthlyIn: state.transactions.filter((tx) => tx.type === 'in' && within(tx.createdAt, currentStart, nextStart)).reduce((sum, tx) => sum + numberValue(tx.quantity), 0),
        monthlyOut: state.transactions.filter((tx) => tx.type === 'out' && within(tx.createdAt, currentStart, nextStart)).reduce((sum, tx) => sum + numberValue(tx.quantity), 0),
        prevMonthIn: state.transactions.filter((tx) => tx.type === 'in' && within(tx.createdAt, previousStart, currentStart)).reduce((sum, tx) => sum + numberValue(tx.quantity), 0),
        prevMonthOut: state.transactions.filter((tx) => tx.type === 'out' && within(tx.createdAt, previousStart, currentStart)).reduce((sum, tx) => sum + numberValue(tx.quantity), 0),
        expiryAlertDays: expiryDays,
        recentTransactions: state.transactions.slice(0, 10).map((tx) => ({
          id: Number(tx.id),
          type: String(tx.type),
          documentNumber: tx.documentNumber ?? null,
          name: state.items.find((item) => item.id === Number(tx.itemId))?.name ?? state.equipment.find((item) => item.id === Number(tx.equipmentId))?.name ?? '—',
          quantity: tx.quantity ?? null,
          createdAt: tx.createdAt,
          createdByName: state.users.find((user) => user.id === Number(tx.createdBy))?.fullName ?? null,
        })),
      });
    });
  }
  if (pathname === '/api/dashboard/charts' && method === 'GET') {
    return read((state) => {
      const stockByCategory = state.categories.map((category) => {
        const rows = state.items.filter((item) => item.categoryId === category.id && item.isActive !== false);
        return { category: category.name, totalStock: rows.reduce((sum, item) => sum + numberValue(item.currentStock), 0), itemCount: rows.length };
      }).filter((row) => row.totalStock > 0);
      const byItem = new Map<number, { name: string; inQty: number; outQty: number }>();
      for (const tx of state.transactions) {
        const id = Number(tx.itemId);
        if (!id || !['in', 'out'].includes(String(tx.type))) continue;
        const item = state.items.find((entry) => entry.id === id);
        if (!item) continue;
        const row = byItem.get(id) ?? { name: String(item.name), inQty: 0, outQty: 0 };
        row[tx.type === 'in' ? 'inQty' : 'outQty'] += numberValue(tx.quantity);
        byItem.set(id, row);
      }
      const dailyMovement = Array.from({ length: 30 }, (_, index) => {
        const date = new Date();
        date.setHours(0, 0, 0, 0);
        date.setDate(date.getDate() - (29 - index));
        const day = date.toISOString().slice(0, 10);
        return {
          day,
          inQty: state.transactions.filter((tx) => String(tx.createdAt ?? '').slice(0, 10) === day && tx.type === 'in').reduce((sum, tx) => sum + numberValue(tx.quantity), 0),
          outQty: state.transactions.filter((tx) => String(tx.createdAt ?? '').slice(0, 10) === day && tx.type === 'out').reduce((sum, tx) => sum + numberValue(tx.quantity), 0),
        };
      });
      return json({ topItems: [...byItem.values()].sort((a, b) => b.inQty + b.outQty - a.inQty - a.outQty).slice(0, 8), stockByCategory, dailyMovement });
    });
  }

  if (pathname === '/api/alerts' && method === 'GET') {
    return read((state) => {
      const generated: Array<Record<string, unknown>> = [];
      for (const item of state.items) {
        const current = numberValue(item.currentStock);
        const minimum = numberValue(item.minStock);
        if (item.isActive !== false && minimum > 0 && current <= minimum) {
          generated.push({
            id: `below_min-${item.id}`, dbId: numberValue(item.id), type: 'below_min',
            entityId: numberValue(item.id), entityType: 'item', entityName: text(item.name, '—'),
            itemName: text(item.name, '—'), message: `الرصيد ${current} أقل من أو يساوي الحد الأدنى ${minimum}`,
            severity: current === 0 ? 'critical' : 'warning', isRead: false, createdAt: now(), updatedAt: now(),
          });
        }
        if (item.isActive !== false && item.expiryDate) {
          const expiry = new Date(String(item.expiryDate));
          if (!Number.isNaN(expiry.getTime()) && expiry.getTime() <= Date.now() + numberValue(state.settings.expiryAlertDays, 30) * 86_400_000) {
            const expired = expiry.getTime() <= Date.now();
            generated.push({
              id: `near_expiry-${item.id}`, dbId: numberValue(item.id), type: 'near_expiry',
              entityId: numberValue(item.id), entityType: 'item', entityName: text(item.name, '—'),
              itemName: text(item.name, '—'), message: expired ? 'المادة منتهية الصلاحية' : `تنتهي الصلاحية في ${String(item.expiryDate).slice(0, 10)}`,
              severity: expired ? 'critical' : 'warning', isRead: false, createdAt: now(), updatedAt: now(),
            });
          }
        }
      }
      for (const equipment of state.equipment) {
        const condition = text(equipment.condition);
        if (['maintenance', 'broken', 'needs_inspection'].includes(condition)) {
          generated.push({
            id: `equipment_maintenance-${equipment.id}`, dbId: numberValue(equipment.id), type: 'equipment_maintenance',
            entityId: numberValue(equipment.id), entityType: 'equipment', entityName: text(equipment.name, '—'),
            message: condition === 'broken' ? 'التجهيز معطل ويحتاج إلى معالجة' : 'التجهيز يحتاج إلى صيانة أو فحص',
            severity: condition === 'broken' ? 'critical' : 'warning', isRead: false, createdAt: now(), updatedAt: now(),
          });
        }
      }
      return json([...state.alerts, ...generated]);
    });
  }
  if (pathname === '/api/alerts/read-all' && method === 'POST') return mutate((state) => {
    state.alerts.forEach((alert) => { alert.isRead = true; });
    return json({ ok: true });
  });
  const alertId = idFrom(pathname, 'alerts');
  if (alertId && pathname === `/api/alerts/${alertId}/read` && method === 'POST') return mutate((state) => {
    const alert = state.alerts.find((entry) => entry.id === alertId);
    if (alert) alert.isRead = true;
    return json({ ok: true });
  });
  if (alertId && pathname === `/api/alerts/${alertId}/resolve` && method === 'POST') return mutate((state) => {
    state.alerts = state.alerts.filter((entry) => entry.id !== alertId);
    return json({ ok: true });
  });
  if (pathname === '/api/alerts/refresh' && method === 'POST') return json({ ok: true });
  if (pathname === '/api/alerts/stream' && method === 'GET') return new Response('', { status: 204, headers: { [OFFLINE_HEADER]: '1' } });

  if (pathname.startsWith('/api/reports/')) {
    return read((state) => {
      if (pathname === '/api/reports/stock') return json(state.items.filter((item) => item.isActive !== false).map((item) => itemWithCategory(state, item)));
      if (pathname === '/api/reports/equipment') return json(state.equipment);
      if (pathname === '/api/reports/expiry') return json(state.items.filter((item) => item.expiryDate));
      if (pathname === '/api/reports/below-min') return json(state.items.filter((item) => numberValue(item.currentStock) <= numberValue(item.minStock)));
      if (pathname === '/api/reports/movements') return json(state.transactions);
       if (pathname === '/api/reports/stock-position') return json({
         items: state.items.filter((item) => item.isActive !== false).map((item) => ({ ...item, availableQuantity: numberValue(item.currentStock), custodyQuantity: 0, damagedQuantity: 0, batches: [] })),
         equipment: state.equipment.map((item) => ({ ...item, availableQuantity: numberValue(item.quantity, 1), custodyQuantity: 0, damagedQuantity: 0 })),
       });
       if (pathname === '/api/reports/custodies') {
         const statusFilter = text(searchParams.get('status'));
         const search = text(searchParams.get('search')).toLocaleLowerCase();
         const overdueDaysRaw = Number.parseInt(text(searchParams.get('overdueDays'), '30'), 10);
         const overdueDays = Number.isSafeInteger(overdueDaysRaw)
           ? Math.min(3650, Math.max(1, overdueDaysRaw))
           : 30;
         const cutoff = new Date();
         cutoff.setDate(cutoff.getDate() - overdueDays);
         const records = state.personalCustodies
           .map((raw) => {
             const equipmentId = numberValue(raw.equipmentId);
             const equipment = state.equipment.find((item) => numberValue(item.id) === equipmentId);
             const quantity = numberValue(raw.quantity);
             const returnedQuantity = numberValue(raw.returnedQuantity);
             const outstandingQuantity = Math.max(0, quantity - returnedQuantity);
             const deliveryDate = text(raw.deliveryDate, text(raw.custodyDate)) || null;
             const status = text(raw.status, outstandingQuantity < quantity ? 'partially_returned' : 'open');
             const overdue = Boolean(
               outstandingQuantity > 0 &&
               deliveryDate &&
               !Number.isNaN(new Date(deliveryDate).getTime()) &&
               new Date(deliveryDate) < cutoff,
             );
             return {
               id: numberValue(raw.id),
               equipmentId,
               equipmentName: text(raw.equipmentName, text(equipment?.name, '—')),
               serialNumber: text(raw.serialNumber, text(equipment?.serialNumber)) || null,
               holderName: text(raw.holderName, text(raw.holderNameSnap, '—')),
               quantity,
               returnedQuantity,
               outstandingQuantity,
               deliveryNoteNumber: text(raw.deliveryNoteNumber, '—'),
               deliveryDate,
               location: text(raw.location, text(raw.custodyLocation, '—')),
               status,
               overdue,
             };
           })
           .filter((record) => ['open', 'partially_returned', 'damaged'].includes(record.status))
           .filter((record) => !statusFilter || record.status === statusFilter)
           .filter((record) => !search || [
             record.equipmentName,
             record.serialNumber,
             record.holderName,
             record.deliveryNoteNumber,
           ].some((value) => String(value ?? '').toLocaleLowerCase().includes(search)));
         return json({
           overdueDays,
           generatedAt: now(),
           records,
           totals: {
             open: records.filter((record) => record.status === 'open').length,
             partial: records.filter((record) => record.status === 'partially_returned').length,
             overdue: records.filter((record) => record.overdue).length,
             outstandingQuantity: records.reduce((sum, record) => sum + record.outstandingQuantity, 0),
           },
         });
       }
      return failure(404, 'التقرير غير موجود');
    });
  }

  if (pathname === '/api/users' && method === 'GET') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'ليس لديك صلاحية');
    return read((state) => json(state.users.map(publicUser)));
  }
  if (pathname === '/api/users' && method === 'POST') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'ليس لديك صلاحية');
    return mutate(async (state) => {
      const body = readBody(init);
      const username = text(body.username);
      if (state.users.some((user) => user.username === username)) return failure(409, 'Username already taken');
      const salt = crypto.randomUUID();
      const user = {
        id: nextId(state),
        username,
        fullName: text(body.fullName),
        role: (text(body.role, 'viewer') as PublicUser['role']),
        passwordHash: await passwordHash(text(body.password, 'ChangeMe123'), salt),
        passwordSalt: salt,
        isActive: body.isActive !== false,
        createdAt: now(),
      };
      state.users.push(user);
      return json(publicUser(user), 201);
    });
  }
  const userId = idFrom(pathname, 'users');
  if (userId && pathname === `/api/users/${userId}` && method === 'PUT') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'ليس لديك صلاحية');
    return mutate((state) => {
      const user = state.users.find((entry) => entry.id === userId);
      if (!user) return failure(404, 'المستخدم غير موجود');
      Object.assign(user, readBody(init));
      return json(publicUser(user));
    });
  }
  if (userId && pathname === `/api/users/${userId}` && method === 'DELETE') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'ليس لديك صلاحية');
    return mutate((state) => {
      state.users = state.users.filter((entry) => entry.id !== userId);
      if (state.currentUserId === userId) state.currentUserId = null;
      return json({ ok: true });
    });
  }

  if (pathname === '/api/settings' && method === 'GET') return read((state) => json(state.settings));
  if (pathname === '/api/settings' && method === 'PUT') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'ليس لديك صلاحية');
    return mutate((state) => {
      Object.assign(state.settings, readBody(init), { updatedAt: now() });
      return json(state.settings);
    });
  }
  if (pathname === '/api/settings/profile' && method === 'PATCH') {
    return mutate((state) => {
      const user = state.users.find((entry) => entry.id === currentUser.id);
      if (!user) return failure(404, 'المستخدم غير موجود');
      Object.assign(user, { fullName: text(readBody(init).fullName, user.fullName) });
      return json(publicUser(user));
    });
  }
  if (pathname === '/api/settings/change-password' && method === 'POST') {
    return mutate(async (state) => {
      const user = state.users.find((entry) => entry.id === currentUser.id);
      if (!user) return failure(404, 'المستخدم غير موجود');
      const body = readBody(init);
      if (text(body.newPassword).length < 8) return failure(400, 'Password must be at least 8 characters');
      const salt = crypto.randomUUID();
      user.passwordSalt = salt;
      user.passwordHash = await passwordHash(text(body.newPassword), salt);
      return json({ ok: true });
    });
  }
  if (pathname === '/api/settings/my-activity' && method === 'GET') return read((state) => json(state.auditLog.filter((entry) => entry.userId === currentUser.id)));
  if (pathname === '/api/audit' && method === 'GET') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'ليس لديك صلاحية');
    return read((state) => {
      const from = text(searchParams.get('from'));
      const to = text(searchParams.get('to'));
      const action = text(searchParams.get('action'));
      const entityType = text(searchParams.get('entityType'));
      const filtered = state.auditLog.filter((entry) =>
        (!from || String(entry.createdAt ?? '').slice(0, 10) >= from) &&
        (!to || String(entry.createdAt ?? '').slice(0, 10) <= to) &&
        (!action || entry.action === action) &&
        (!entityType || entry.entityType === entityType)
      );
      const page = paged(filtered, searchParams);
      return json({
        data: page.rows,
        total: page.total,
        page: page.page,
        totalPages: Math.max(1, Math.ceil(page.total / page.limit)),
      });
    });
  }
  if (pathname === '/api/backup/info' && method === 'GET') return read((state) => json({ version: 1, size: JSON.stringify(state).length, updatedAt: state.settings.updatedAt }));
  if (pathname === '/api/backup/export' && method === 'GET') return read((state) => new Response(JSON.stringify({ version: 1, exportedAt: now(), data: state }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'content-disposition': 'attachment; filename="damascus-backup.json"', [OFFLINE_HEADER]: '1' },
  }));
  if (pathname === '/api/backups/export' && method === 'POST') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'ليس لديك صلاحية');
    return read((state) => new Response(JSON.stringify({ version: 1, exportedAt: now(), data: state }, null, 2), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'content-disposition': `attachment; filename="damascus-offline-${now().slice(0, 10)}.json"`,
        [OFFLINE_HEADER]: '1',
      },
    }));
  }
  if (pathname === '/api/backups/inspect' && method === 'POST') {
    const body = readBody(init);
    try {
      const pkg = await readDmeSyncPackageInWorker(Uint8Array.from(atob(text(body.packageBase64)), (character) => character.charCodeAt(0)), text(body.password));
      return json(dmePackageSummary(pkg));
    } catch (error) {
      return failure(400, error instanceof Error ? error.message : 'تعذر فحص الحزمة');
    }
  }
  if (pathname === '/api/backups/dry-run' && method === 'POST') {
    const body = readBody(init);
    try {
      const pkg = await readDmeSyncPackageInWorker(Uint8Array.from(atob(text(body.packageBase64)), (character) => character.charCodeAt(0)), text(body.password));
      const token = crypto.randomUUID();
       const supported = new Set([
         'categories',
         'items',
         'equipment',
         'recipients',
         'exit_reasons',
         'system_settings',
         'transactions',
         'inventory_batches',
         'transaction_batch_allocations',
         'personal_custodies',
         'custody_returns',
         'damage_records',
         'central_returns',
         'audit_log',
       ]);
      const records = pkg.records.map((record) => ({
        entityType: record.entityType,
        localId: record.localId ?? null,
        status: record.entityType === 'users' || !supported.has(record.entityType) ? 'skipped' : 'applied',
        ...(record.entityType === 'users' ? { code: 'users-not-restored' } : {}),
      }));
      const counts = records.reduce<Record<string, number>>((result, record) => {
        result[record.status] = (result[record.status] ?? 0) + 1;
        return result;
      }, {});
      pendingDmePreview = { token, packageHash: pkg.packageHash, mode: text(body.mode) === 'full' ? 'full' : 'merge', pkg };
      // IndexedDB persistence is only a recovery aid. Do not hold the Dry Run
      // response on a WebView structured-clone transaction; some Android
      // WebViews can keep that transaction pending for large packages.
      void savePendingPreview(pendingDmePreview).catch((error) => {
        console.warn('Could not persist offline restore preview:', error);
      });
      return json({ token, report: { mode: pendingDmePreview.mode, packageHash: pkg.packageHash, packageType: pkg.manifest.packageType, counts: { total: records.length, applied: counts.applied ?? 0, duplicate: 0, rejected: 0, conflict: 0, skipped: counts.skipped ?? 0 }, records }, summary: dmePackageSummary(pkg) });
    } catch (error) {
      return failure(400, error instanceof Error ? error.message : 'تعذر تنفيذ المعاينة');
    }
  }
  if (pathname === '/api/backups/restore' && method === 'POST') {
    const body = readBody(init);
    if (body.confirm !== true) return failure(400, 'يجب تأكيد الاستعادة بعد المعاينة');
    const preview = pendingDmePreview ?? await loadPendingPreview();
    if (!preview || preview.token !== text(body.previewToken)) return failure(400, 'المعاينة غير موجودة أو منتهية');
    if (preview.mode !== (text(body.mode) === 'full' ? 'full' : 'merge')) return failure(400, 'نمط الاستعادة لا يطابق المعاينة');
    return mutate((state) => {
       const entities: Record<string, keyof OfflineState> = {
        categories: 'categories',
        items: 'items',
        equipment: 'equipment',
        recipients: 'recipients',
        exit_reasons: 'exitReasons',
        transactions: 'transactions',
         inventory_batches: 'inventoryBatches',
         transaction_batch_allocations: 'transactionBatchAllocations',
         personal_custodies: 'personalCustodies',
         custody_returns: 'custodyReturns',
         damage_records: 'damageRecords',
         central_returns: 'centralReturns',
        audit_log: 'auditLog',
      };
      const camelize = (value: Record<string, unknown>) =>
        Object.fromEntries(Object.entries(value).map(([key, entry]) => [key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), entry]));
       if (preview.mode === 'full') {
         for (const key of Object.values(entities)) {
           if (key !== 'auditLog') (state[key] as unknown[]) = [];
         }
       }
      let applied = 0;
      let skipped = 0;
      for (const record of preview.pkg.records) {
        if (record.entityType === 'system_settings') {
          Object.assign(state.settings, camelize(record.data));
          applied += 1;
          continue;
        }
        const key = entities[record.entityType];
        if (!key || record.entityType === 'users') {
          skipped += 1;
          continue;
        }
        const rows = state[key] as unknown[];
         const value = camelize(record.data);
         for (const reference of ['createdBy', 'userId']) {
           const referencedUser = value[reference];
           if (
             referencedUser != null &&
             !state.users.some((user) => user.id === referencedUser) &&
             state.currentUserId != null
           ) {
             value[reference] = state.currentUserId;
           }
         }
        const index = rows.findIndex((row) => (row as Record<string, unknown>).id === value.id);
        if (preview.mode === 'merge' && index >= 0) rows[index] = { ...(rows[index] as object), ...value };
        else if (index >= 0) rows[index] = value;
        else rows.push(value);
        applied += 1;
      }
       const restoredIds = Object.values(entities)
         .flatMap((key) => (state[key] as Array<Record<string, unknown>>))
         .map((row) => Number(row.id))
         .filter((id) => Number.isInteger(id) && id > 0);
       if (restoredIds.length) state.nextId = Math.max(state.nextId, Math.max(...restoredIds) + 1);
       pendingDmePreview = null;
      return json({ counts: { total: preview.pkg.records.length, applied, duplicate: 0, rejected: 0, conflict: 0, skipped }, restorePointId: null });
    }).then((response) => {
      // The restore has already been committed to the state store. Clearing
      // the recovery copy must never keep the UI spinner active.
      void clearPendingPreview().catch((error) => {
        console.warn('Could not clear offline restore preview:', error);
      });
      return response;
    });
  }

  if (pathname === '/api/sync/node' && method === 'GET') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'ليس لديك صلاحية');
    return read((state) => json({ nodeId: state.nodeIdentity.nodeId, vector: syncVector(state) }));
  }
  if (pathname === '/api/sync/export' && method === 'POST') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'ليس لديك صلاحية');
    const body = readBody(init);
    const password = text(body.password);
    if (password.length < 8) return failure(400, 'كلمة مرور الحزمة يجب أن تكون 8 أحرف على الأقل');
    return mutate(async (state) => {
      const changes = state.changeLog.filter((entry) => text(entry.status) !== 'rejected');
      const records: Array<{ entityType: string; localId: number; data: Record<string, unknown> }> = [];
      for (const mapping of state.entityIds) {
        const key = STATE_KEY_BY_ENTITY[mapping.entityType];
        if (!key || key === 'users') continue;
        const row = ((state as unknown as Record<string, unknown[]>)[key] as Array<Record<string, unknown>>).find((entry) => numberValue(entry.id) === mapping.localId);
        if (row) records.push({ entityType: mapping.entityType, localId: mapping.localId, data: row });
      }
      const bytes = await writeDmeSyncPackage({
        password,
        packageType: 'full-backup',
        schemaVersion: '1',
        sourceNodeId: state.nodeIdentity.nodeId,
        records,
        changes,
        lastVector: syncVector(state),
      });
      return new Response(bytes.slice().buffer as ArrayBuffer, {
        status: 200,
        headers: {
          'content-type': 'application/octet-stream',
          'content-disposition': `attachment; filename="damascus-sync-${now().slice(0, 10)}.dme-sync"`,
          [OFFLINE_HEADER]: '1',
        },
      });
    });
  }
  if (pathname === '/api/sync/import' && method === 'POST') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'ليس لديك صلاحية');
    const body = readBody(init);
    let pkg;
    try {
      pkg = await readDmeSyncPackageInWorker(
        Uint8Array.from(atob(text(body.packageBase64)), (character) => character.charCodeAt(0)),
        text(body.password),
      );
    } catch (error) {
      return failure(400, error instanceof Error ? error.message : 'تعذر فك تشفير الحزمة');
    }
    return mutate((state) => {
      const counts = applyOfflineChanges(state, pkg.changes);
      return json({ mode: 'sync-apply', report: { counts } });
    });
  }

  return failure(404, 'المسار غير موجود في الوضع المحلي');
}

export function installOfflineApi() {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
    if (!url.pathname.startsWith('/api/')) return originalFetch(input, init);
    try {
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      const response = await withTimeout(
        route(url.pathname, url.searchParams, method, init),
        'انتهت مهلة تنفيذ العملية المحلية',
        OFFLINE_REQUEST_TIMEOUT_MS,
      );
      return response;
    } catch (error) {
      console.error('Offline API error:', error);
      return failure(500, error instanceof Error ? error.message : 'تعذر تنفيذ العملية المحلية');
    }
  };
}