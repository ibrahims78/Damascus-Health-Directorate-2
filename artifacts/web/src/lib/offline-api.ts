import { dmePackageSummary, readDmeSyncPackageInWorker, writeDmeSyncPackage } from './dme-sync-browser';
import {
  type CatalogAnalysis,
  type CatalogEquipmentRow,
  type CatalogImportMode,
  type CatalogItemRow,
  type CatalogValidationContext,
  createCategoryLookup,
  createUnitLookup,
  DEFAULT_INVENTORY_UNITS,
  INVENTORY_TEMPLATE_VERSION,
  normalizeHeader,
  validateCatalogEquipmentRows,
  validateCatalogItemRows,
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
  units: Array<Record<string, unknown>>;
  warehouses: Array<Record<string, unknown>>;
  currentWarehouseId: number | null;
  transfers: Array<Record<string, unknown>>;
  transferLines: Array<Record<string, unknown>>;
  importBatches: Array<Record<string, unknown>>;
  documentSequences: Array<Record<string, unknown>>;
  countSessions: Array<Record<string, unknown>>;
  countLines: Array<Record<string, unknown>>;
};

const DB_NAME = 'damascus-emergency-inventory-offline';
const DB_VERSION = 2;
const STORE_NAME = 'state';
const STATE_KEY = 'current';
const PREVIEW_KEY = 'pending-restore-preview';
const OFFLINE_HEADER = 'X-Damascus-Offline';
const INDEXED_DB_TIMEOUT_MS = 15_000;
const OFFLINE_REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_ORG_NAME = 'Ù…Ø³ØªÙˆØ¯Ø¹Ø§Øª Ù…Ø¯ÙŠØ±ÙŠØ© ØµØ­Ø© Ø¯Ù…Ø´Ù‚';

function isLegacyOrgName(value: string): boolean {
  const normalized = value.trim();
  return (
    normalized !== DEFAULT_ORG_NAME &&
    /^(Ù…Ù†Ø¸ÙˆÙ…Ø©|Ù†Ø¸Ø§Ù…)\s/u.test(normalized) &&
    /(Ø§Ù„Ø¥Ø­Ø§Ù„Ø©|Ø§Ù„Ø§Ø­Ø§Ù„Ø©|Ø§Ù„Ø¥Ø³Ø¹Ø§Ù ÙˆØ§Ù„Ø·ÙˆØ§Ø±Ø¦|Ø§Ù„Ø§Ø³Ø¹Ø§Ù ÙˆØ§Ù„Ø·ÙˆØ§Ø±Ø¦)/u.test(normalized)
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
    nextId: 2,
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
      { id: 1, name: 'Ù…ÙˆØ§Ø¯ Ø·Ø¨ÙŠØ©', type: 'consumable', createdAt: timestamp },
      { id: 2, name: 'ØªØ¬Ù‡ÙŠØ²Ø§Øª', type: 'equipment', createdAt: timestamp },
    ],
    items: [],
    equipment: [],
    recipients: [],
    exitReasons: [
      { id: 1, name: 'ØµØ±Ù Ø§Ø¹ØªÙŠØ§Ø¯ÙŠ', isSystem: true, isActive: true, createdAt: timestamp },
      { id: 2, name: 'ØªÙ„Ù', isSystem: true, isActive: true, createdAt: timestamp },
      { id: 3, name: 'Ø¥Ø±Ø¬Ø§Ø¹ Ù…Ø±ÙƒØ²ÙŠ', isSystem: true, isActive: true, createdAt: timestamp },
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
    units: [],
    warehouses: [
      {
        id: 1,
        code: 'C',
        name: 'Ø§Ù„Ù…Ø³ØªÙˆØ¯Ø¹ Ø§Ù„Ù…Ø±ÙƒØ²ÙŠ',
        type: 'central',
        notes: null,
        isActive: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    currentWarehouseId: 1,
    transfers: [],
    transferLines: [],
    importBatches: [],
    documentSequences: [],
    countSessions: [],
    countLines: [],
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
      request.onerror = () => reject(request.error ?? new Error('ØªØ¹Ø°Ø± ÙØªØ­ Ù‚Ø§Ø¹Ø¯Ø© Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ù…Ø­Ù„ÙŠØ©'));
      request.onblocked = () => reject(new Error('Ù‚Ø§Ø¹Ø¯Ø© Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ù…Ø­Ù„ÙŠØ© Ù…Ø´ØºÙˆÙ„Ø© Ø¨Ø¹Ù…Ù„ÙŠØ© Ø£Ø®Ø±Ù‰'));
    }),
    'Ø§Ù†ØªÙ‡Øª Ù…Ù‡Ù„Ø© ÙØªØ­ Ù‚Ø§Ø¹Ø¯Ø© Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ù…Ø­Ù„ÙŠØ©',
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
        transaction.onerror = () => reject(transaction.error ?? new Error('ØªØ¹Ø°Ø± Ù‚Ø±Ø§Ø¡Ø© Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ù…Ø­Ù„ÙŠØ©'));
        transaction.onabort = () => reject(transaction.error ?? new Error('ØªÙ… Ø¥Ù„ØºØ§Ø¡ Ù‚Ø±Ø§Ø¡Ø© Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ù…Ø­Ù„ÙŠØ©'));
      }),
      'Ø§Ù†ØªÙ‡Øª Ù…Ù‡Ù„Ø© Ù‚Ø±Ø§Ø¡Ø© Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ù…Ø­Ù„ÙŠØ©',
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
      units: existing.units ?? fresh.units,
      warehouses: existing.warehouses ?? fresh.warehouses,
      currentWarehouseId: existing.currentWarehouseId ?? fresh.currentWarehouseId,
      transfers: existing.transfers ?? fresh.transfers,
      transferLines: existing.transferLines ?? fresh.transferLines,
      importBatches: existing.importBatches ?? fresh.importBatches,
      documentSequences: existing.documentSequences ?? fresh.documentSequences,
      countSessions: existing.countSessions ?? fresh.countSessions,
      countLines: existing.countLines ?? fresh.countLines,
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
        finish(new Error('Ø§Ù†ØªÙ‡Øª Ù…Ù‡Ù„Ø© Ø­ÙØ¸ Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ù…Ø­Ù„ÙŠØ©'));
      }, 15000);
      const clear = () => window.clearTimeout(timeout);
      request.onerror = () => {
        clear();
        finish(request.error ?? new Error('ØªØ¹Ø°Ø± Ø­ÙØ¸ Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ù…Ø­Ù„ÙŠØ©'));
      };
      transaction.oncomplete = () => {
        clear();
        finish();
      };
      transaction.onerror = () => {
        clear();
        finish(transaction.error ?? new Error('ØªØ¹Ø°Ø± Ø­ÙØ¸ Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ù…Ø­Ù„ÙŠØ©'));
      };
      transaction.onabort = () => {
        clear();
        finish(transaction.error ?? new Error('ØªÙ… Ø¥Ù„ØºØ§Ø¡ Ø­ÙØ¸ Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ù…Ø­Ù„ÙŠØ©'));
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
        request.onerror = () => reject(request.error ?? new Error('ØªØ¹Ø°Ø± Ø­ÙØ¸ Ù†Ù‚Ø·Ø© Ø§Ù„Ø§Ø³ØªØ¹Ø§Ø¯Ø© Ø§Ù„Ù…Ø­Ù„ÙŠØ©'));
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('ØªØ¹Ø°Ø± Ø­ÙØ¸ Ù†Ù‚Ø·Ø© Ø§Ù„Ø§Ø³ØªØ¹Ø§Ø¯Ø© Ø§Ù„Ù…Ø­Ù„ÙŠØ©'));
        transaction.onabort = () => reject(transaction.error ?? new Error('ØªÙ… Ø¥Ù„ØºØ§Ø¡ Ø­ÙØ¸ Ù†Ù‚Ø·Ø© Ø§Ù„Ø§Ø³ØªØ¹Ø§Ø¯Ø© Ø§Ù„Ù…Ø­Ù„ÙŠØ©'));
      }),
      'Ø§Ù†ØªÙ‡Øª Ù…Ù‡Ù„Ø© Ø­ÙØ¸ Ù†Ù‚Ø·Ø© Ø§Ù„Ø§Ø³ØªØ¹Ø§Ø¯Ø© Ø§Ù„Ù…Ø­Ù„ÙŠØ©',
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
        request.onerror = () => reject(request.error ?? new Error('ØªØ¹Ø°Ø± Ø­Ø°Ù Ù†Ù‚Ø·Ø© Ø§Ù„Ø§Ø³ØªØ¹Ø§Ø¯Ø© Ø§Ù„Ù…Ø­Ù„ÙŠØ©'));
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('ØªØ¹Ø°Ø± Ø­Ø°Ù Ù†Ù‚Ø·Ø© Ø§Ù„Ø§Ø³ØªØ¹Ø§Ø¯Ø© Ø§Ù„Ù…Ø­Ù„ÙŠØ©'));
        transaction.onabort = () => reject(transaction.error ?? new Error('ØªÙ… Ø¥Ù„ØºØ§Ø¡ Ø­Ø°Ù Ù†Ù‚Ø·Ø© Ø§Ù„Ø§Ø³ØªØ¹Ø§Ø¯Ø© Ø§Ù„Ù…Ø­Ù„ÙŠØ©'));
      }),
      'Ø§Ù†ØªÙ‡Øª Ù…Ù‡Ù„Ø© Ø­Ø°Ù Ù†Ù‚Ø·Ø© Ø§Ù„Ø§Ø³ØªØ¹Ø§Ø¯Ø© Ø§Ù„Ù…Ø­Ù„ÙŠØ©',
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
  if (!key || key === 'users') throw new Error(`Ù†ÙˆØ¹ Ø§Ù„ÙƒÙŠØ§Ù† ØºÙŠØ± Ù…Ø¯Ø¹ÙˆÙ…: ${text(change.entityType)}`);
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
  if (!bundle.transaction) throw new Error('Ø­Ø²Ù…Ø© Ø­Ø±ÙƒØ© ØºÙŠØ± Ù…ÙƒØªÙ…Ù„Ø©');
  const txRow = { ...bundle.transaction };
  if (txRow.itemGlobalId != null) {
    const itemId = resolveGlobalId(state, 'item', String(txRow.itemGlobalId));
    if (itemId == null) throw new Error('Ø§Ù„Ù…Ø§Ø¯Ø© Ø§Ù„Ù…Ø±Ø¬Ø¹ÙŠØ© Ù„Ù„Ø­Ø±ÙƒØ© ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯Ø© Ù…Ø­Ù„ÙŠØ§Ù‹');
    txRow.itemId = itemId;
  }
  if (txRow.equipmentGlobalId != null) {
    const equipmentId = resolveGlobalId(state, 'equipment', String(txRow.equipmentGlobalId));
    if (equipmentId == null) throw new Error('Ø§Ù„Ù…Ø¹Ø¯Ø© Ø§Ù„Ù…Ø±Ø¬Ø¹ÙŠØ© Ù„Ù„Ø­Ø±ÙƒØ© ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯Ø© Ù…Ø­Ù„ÙŠØ§Ù‹');
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
        message: error instanceof Error ? error.message : 'ØªØ¹Ø°Ø± ØªØ·Ø¨ÙŠÙ‚ Ø§Ù„ØªØºÙŠÙŠØ±',
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

function catalogMode(value: unknown): CatalogImportMode {
  return value === 'add-only' ? 'add-only' : 'add-and-update';
}

function catalogRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    : [];
}

/**
 * Reference context for the catalog import.
 *
 * Offline there is no server-side units table, so the accepted units are the
 * shared default inventory units plus every unit already present locally; the
 * categories come from the local catalog. Rules stay identical to the server
 * because both sides call the same validators from @workspace/api-zod.
 */
function catalogContext(state: OfflineState, mode: CatalogImportMode): CatalogValidationContext {
  const knownUnits = new Set<string>();
  for (const unit of DEFAULT_INVENTORY_UNITS) knownUnits.add(unit);
  for (const item of state.items) {
    const unit = text(item.unit);
    if (unit) knownUnits.add(unit);
  }
  if (state.settings.unitsList) {
    try {
      const parsed = JSON.parse(state.settings.unitsList) as unknown;
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          const name = typeof entry === 'string' ? entry : text((entry as { name?: unknown } | null)?.name);
          if (name) knownUnits.add(name);
        }
      }
    } catch {
      /* legacy non-JSON list - ignore */
    }
  }

  const knownCategories = new Set(state.categories.map((category) => category.name));

  const existingItemKeys = new Set<string>();
  for (const item of state.items) {
    const code = text(item.code);
    if (code) existingItemKeys.add(`code:${code}`);
    else existingItemKeys.add(`name:${text(item.name)}|unit:${text(item.unit)}`);
  }

  const existingEquipmentKeys = new Set<string>();
  for (const entry of state.equipment) {
    const serial = text(entry.serialNumber);
    if (serial) existingEquipmentKeys.add(`serial:${serial}`);
    else existingEquipmentKeys.add(`name:${text(entry.name)}|model:${text(entry.model)}`);
  }

  return { knownUnits, knownCategories, existingItemKeys, existingEquipmentKeys, mode };
}

function catalogSummary(
  items: CatalogAnalysis<CatalogItemRow>,
  equipment: CatalogAnalysis<CatalogEquipmentRow>,
) {
  return {
    items: items.summary,
    equipment: equipment.summary,
    totals: {
      create: items.summary.create + equipment.summary.create,
      update: items.summary.update + equipment.summary.update,
      skip: items.summary.skip + equipment.summary.skip,
      error: items.summary.error + equipment.summary.error,
    },
  };
}

function offlineWarehouseView(warehouse: Record<string, unknown> | null | undefined) {
  if (!warehouse) return null;
  return {
    id: numberValue(warehouse.id),
    code: text(warehouse.code),
    name: text(warehouse.name),
    type: text(warehouse.type, 'central'),
  };
}

/** The installation's current warehouse: explicit choice, else the central one. */
function offlineCurrentWarehouse(state: OfflineState) {
  const chosen = state.warehouses.find(
    (warehouse) => numberValue(warehouse.id) === numberValue(state.currentWarehouseId),
  );
  if (chosen) return offlineWarehouseView(chosen);
  const central = state.warehouses.find((warehouse) => text(warehouse.type) === 'central');
  if (central) return offlineWarehouseView(central);
  return offlineWarehouseView(state.warehouses[0]);
}

function offlineWarehouseId(state: OfflineState): number {
  return offlineCurrentWarehouse(state)?.id ?? numberValue(state.currentWarehouseId, 1);
}

/** `CODE-TYPE-YEAR-NNNNNN` per warehouse, mirroring the server counter. */
function offlineNextDocumentNumber(
  state: OfflineState,
  docType: string,
  year = new Date().getFullYear(),
): string | null {
  const warehouse = offlineCurrentWarehouse(state);
  if (!warehouse) return null;
  const existing = state.documentSequences.find(
    (sequence) =>
      numberValue(sequence.warehouseId) === warehouse.id &&
      text(sequence.docType) === docType &&
      numberValue(sequence.year) === year,
  );
  let n = 1;
  if (existing) {
    n = numberValue(existing.lastNumber) + 1;
    existing.lastNumber = n;
    existing.updatedAt = now();
  } else {
    state.documentSequences.push({
      id: nextId(state),
      warehouseId: warehouse.id,
      docType,
      year,
      lastNumber: 1,
      updatedAt: now(),
    });
  }
  return `${warehouse.code}-${docType}-${year}-${String(n).padStart(6, '0')}`;
}

function offlineTransferSummary(state: OfflineState, id: number) {
  const transfer = state.transfers.find((entry) => numberValue(entry.id) === id);
  if (!transfer) return null;
  const lines = state.transferLines
    .filter((line) => numberValue(line.transferId) === id)
    .map((line) => {
      const item = state.items.find((entry) => numberValue(entry.id) === numberValue(line.itemId));
      return {
        ...line,
        item: item
          ? {
              id: numberValue(item.id),
              code: text(item.code) || null,
              name: text(item.name),
              unit: text(item.unit),
            }
          : null,
      };
    });
  return { ...transfer, lines };
}

/** Outbound leg: consumes batches FEFO and lowers the cached stock. */
/** Opens a batch for an inbound movement so the ledger stays the source of truth. */
function offlineOpenBatch(
  state: OfflineState,
  itemId: number,
  quantity: number,
  warehouseId: number,
  fields: {
    batchNumber: string | null;
    expiryDate: string | null;
    supplier: string | null;
    deliveryNoteNumber: string;
    deliveryNoteDate: string;
  },
) {
  const batch = {
    id: nextId(state),
    itemId,
    warehouseId,
    batchNumber: fields.batchNumber,
    receivedQuantity: quantity,
    remainingQuantity: quantity,
    expiryDate: fields.expiryDate,
    supplier: fields.supplier,
    deliveryNoteNumber: fields.deliveryNoteNumber,
    deliveryNoteDate: fields.deliveryNoteDate,
    createdAt: now(),
  };
  state.inventoryBatches.push(batch);
  return batch;
}

/** Balance of one item inside one warehouse, read from the batch ledger. */
function offlineWarehouseBalance(state: OfflineState, itemId: number, warehouseId: number): number {
  return state.inventoryBatches
    .filter(
      (batch) =>
        numberValue(batch.itemId) === itemId &&
        numberValue(batch.warehouseId, warehouseId) === warehouseId,
    )
    .reduce((sum, batch) => sum + numberValue(batch.remainingQuantity), 0);
}

/** Consumes batches FEFO whenever stock leaves a warehouse. Returns the shortfall. */
function offlineConsumeBatches(
  state: OfflineState,
  itemId: number,
  quantity: number,
  warehouseId: number,
): number {
  const batches = state.inventoryBatches
    .filter(
      (batch) =>
        numberValue(batch.itemId) === itemId &&
        numberValue(batch.warehouseId, warehouseId) === warehouseId &&
        numberValue(batch.remainingQuantity) > 0,
    )
    .sort((a, b) =>
      String(text(a.expiryDate) || '9999-12-31').localeCompare(String(text(b.expiryDate) || '9999-12-31')),
    );
  let remaining = quantity;
  for (const batch of batches) {
    if (remaining <= 0) break;
    const available = numberValue(batch.remainingQuantity);
    const take = Math.min(available, remaining);
    if (take <= 0) continue;
    batch.remainingQuantity = available - take;
    remaining -= take;
    state.transactionBatchAllocations.push({
      id: nextId(state),
      batchId: numberValue(batch.id),
      itemId,
      quantity: take,
      transactionId: null,
      createdAt: now(),
    });
    recordOfflineChange(state, 'inventory_batch', numberValue(batch.id), 'update', {
      remainingQuantity: batch.remainingQuantity,
    });
  }
  return remaining;
}
function offlineApplyTransferOut(
  state: OfflineState,
  itemId: number,
  quantity: number,
  warehouseId: number,
  code: string,
  date: string,
  user: PublicUser | null,
): { shortfall: number } {
  const batches = state.inventoryBatches
    .filter(
      (batch) =>
        numberValue(batch.itemId) === itemId &&
        numberValue(batch.warehouseId, warehouseId) === warehouseId &&
        numberValue(batch.remainingQuantity) > 0,
    )
    .sort((a, b) =>
      String(text(a.expiryDate) || '9999-12-31').localeCompare(String(text(b.expiryDate) || '9999-12-31')),
    );
  let remaining = quantity;
  for (const batch of batches) {
    if (remaining <= 0) break;
    const available = numberValue(batch.remainingQuantity);
    const take = Math.min(available, remaining);
    if (take <= 0) continue;
    batch.remainingQuantity = available - take;
    remaining -= take;
    state.transactionBatchAllocations.push({
      id: nextId(state),
      batchId: numberValue(batch.id),
      itemId,
      quantity: take,
      transactionId: null,
      createdAt: now(),
    });
  }
  const item = state.items.find((entry) => numberValue(entry.id) === itemId);
  if (item) item.currentStock = numberValue(item.currentStock) - quantity;
  const transaction = {
    id: nextId(state),
    type: 'out',
    documentNumber: code,
    transactionDate: date,
    itemId,
    quantity,
    notes: `Ø¥Ø±Ø³Ø§Ù„ ØªØ­ÙˆÙŠÙ„ ${code}`,
    createdBy: user?.id ?? null,
    createdAt: now(),
    warehouseId,
  };
  state.transactions.unshift(transaction);
  recordOfflineChange(state, 'transaction', Number(transaction.id), 'create', {
    type: 'out',
    documentNumber: code,
    itemId,
    quantity,
  });
  if (item) {
    recordOfflineChange(state, 'item', numberValue(item.id), 'update', {
      name: text(item.name),
      quantity: numberValue(item.currentStock),
    });
  }
  return { shortfall: remaining };
}

/** Inbound leg: opens a batch in the destination warehouse. */
function offlineApplyTransferIn(
  state: OfflineState,
  itemId: number,
  quantity: number,
  warehouseId: number,
  deliveryNoteNumber: string,
  date: string,
  batchNumber: string | null,
  expiryDate: string | null,
  user: PublicUser | null,
): void {
  const batch = {
    id: nextId(state),
    itemId,
    warehouseId,
    batchNumber: batchNumber ?? `TRF-${deliveryNoteNumber}`,
    receivedQuantity: quantity,
    remainingQuantity: quantity,
    expiryDate: expiryDate ?? null,
    supplier: null,
    deliveryNoteNumber,
    deliveryNoteDate: date,
    createdAt: now(),
  };
  state.inventoryBatches.push(batch);
  const item = state.items.find((entry) => numberValue(entry.id) === itemId);
  if (item) item.currentStock = numberValue(item.currentStock) + quantity;
  const transaction = {
    id: nextId(state),
    type: 'in',
    documentNumber: deliveryNoteNumber,
    transactionDate: date,
    itemId,
    quantity,
    notes: `Ø§Ø³ØªÙ„Ø§Ù… ØªØ­ÙˆÙŠÙ„ ${deliveryNoteNumber}`,
    createdBy: user?.id ?? null,
    createdAt: now(),
    warehouseId,
  };
  state.transactions.unshift(transaction);
  recordOfflineChange(state, 'inventory_batch', Number(batch.id), 'create', { ...batch });
  recordOfflineChange(state, 'transaction', Number(transaction.id), 'create', {
    type: 'in',
    documentNumber: deliveryNoteNumber,
    itemId,
    quantity,
  });
  if (item) {
    recordOfflineChange(state, 'item', numberValue(item.id), 'update', {
      name: text(item.name),
      quantity: numberValue(item.currentStock),
    });
  }
}

function offlineCountSession(state: OfflineState, id: number) {
  const session = state.countSessions.find((entry) => numberValue(entry.id) === id);
  if (!session) return null;
  return {
    ...session,
    lines: state.countLines
      .filter((line) => numberValue(line.sessionId) === id)
      .map((line) => ({ ...line })),
  };
}

function offlineRefreshCount(state: OfflineState, id: number) {
  const session = state.countSessions.find((entry) => numberValue(entry.id) === id);
  if (!session) return;
  const lines = state.countLines.filter((line) => numberValue(line.sessionId) === id);
  session.countedLines = lines.filter((line) => line.countedQuantity !== null && line.countedQuantity !== undefined).length;
  session.varianceLines = lines.filter((line) => numberValue(line.variance) !== 0).length;
  session.totalVariance = lines.reduce((sum, line) => sum + numberValue(line.variance), 0);
  session.updatedAt = now();
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
    userNameSnap: user?.fullName ?? 'Ù…Ø­Ù„ÙŠ',
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
    unit: text(body.unit, text(existing?.unit, 'Ù‚Ø·Ø¹Ø©')),
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
        return failure(401, 'Ø§Ø³Ù… Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù… Ø£Ùˆ ÙƒÙ„Ù…Ø© Ø§Ù„Ù…Ø±ÙˆØ± ØºÙŠØ± ØµØ­ÙŠØ­Ø©');
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
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
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
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
    return mutate((state) => {
      const category = state.categories.find((entry) => entry.id === categoryId);
      if (!category) return failure(404, 'Ø§Ù„ØªØµÙ†ÙŠÙ ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯');
      const body = readBody(init);
      category.name = text(body.name, category.name);
      category.type = text(body.type, category.type);
      recordOfflineChange(state, 'category', category.id, 'update', { name: category.name, type: category.type });
      addAudit(state, currentUser, 'update', 'category', category.id);
      return json(category);
    });
  }
  if (categoryId && pathname === `/api/categories/${categoryId}` && method === 'DELETE') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
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
    if (!roleAllowed(currentUser, ['admin', 'warehouse_manager'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
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
      return item ? json(itemWithCategory(state, item)) : failure(404, 'Ø§Ù„Ù…Ø§Ø¯Ø© ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯Ø©');
    });
  }
  if (itemId && pathname === `/api/items/${itemId}` && method === 'PUT') {
    if (!roleAllowed(currentUser, ['admin', 'warehouse_manager'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
    return mutate((state) => {
      const index = state.items.findIndex((entry) => entry.id === itemId);
      if (index < 0) return failure(404, 'Ø§Ù„Ù…Ø§Ø¯Ø© ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯Ø©');
      state.items[index] = itemFromInput(state, readBody(init), state.items[index]);
      addAudit(state, currentUser, 'update', 'item', itemId);
      return json(itemWithCategory(state, state.items[index]));
    });
  }
  if (itemId && pathname === `/api/items/${itemId}` && method === 'DELETE') {
    if (!roleAllowed(currentUser, ['admin', 'warehouse_manager'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
    return mutate((state) => {
      const item = state.items.find((entry) => entry.id === itemId);
      if (!item) return failure(404, 'Ø§Ù„Ù…Ø§Ø¯Ø© ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯Ø©');
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
      if (!rawItem) return failure(404, 'Ø§Ù„Ù…Ø§Ø¯Ø© ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯Ø©');
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
          name: text(item.name, 'â€”'),
          categoryName: text(item.categoryName) || null,
          itemType: text(item.itemType, 'item'),
          unit: text(item.unit, 'Ù‚Ø·Ø¹Ø©'),
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
    if (!roleAllowed(currentUser, ['admin', 'warehouse_manager'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
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
          error: 'Ù„Ø§ ÙŠÙ…ÙƒÙ† ØªÙ†ÙÙŠØ° Ø§Ù„Ø§Ø³ØªÙŠØ±Ø§Ø¯ Ù‚Ø¨Ù„ Ù…Ø¹Ø§Ù„Ø¬Ø© Ø§Ù„Ø£Ø®Ø·Ø§Ø¡ Ø§Ù„Ø­Ø±Ø¬Ø©',
          valid: false,
          errors: preflightErrors.map((decision) => ({
            row: decision.row.rowNumber,
            name: decision.row.code || `ØµÙ ${decision.row.rowNumber}`,
            error: decision.errors.map((issue) => issue.message).join('Ø› '),
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
        const name = row.name || `ØµÙ ${row.rowNumber}`;
        if (decision.state === 'empty') continue;
        for (const warning of decision.warnings) {
          warnings.push({ row: row.rowNumber, name, warning: warning.message });
        }
        if (decision.errors.length) {
          errors.push({
            row: row.rowNumber,
            name,
            error: decision.errors.map((issue) => issue.message).join('Ø› '),
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
              deliveryNoteNumber: `Ø§ÙØªØªØ§Ø­ÙŠ-${item.id}`,
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
        if (!item) return failure(400, `Ø§Ù„Ù…Ø§Ø¯Ø© Ø°Ø§Øª Ø§Ù„Ø±Ù…Ø² ${decision.row.code} ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯Ø©`);
        const quantity = numberValue(decision.row.quantity);
        const batch = {
          id: nextId(state),
          itemId: item.id,
          batchNumber: decision.row.batchNumber,
          receivedQuantity: quantity,
          remainingQuantity: quantity,
          expiryDate: decision.row.expiryDate,
          supplier: decision.row.supplier,
          deliveryNoteNumber: decision.row.deliveryNoteNumber ?? `Ø§Ø³ØªÙŠØ±Ø§Ø¯-Ø¯ÙØ¹Ø©-${item.id}-${decision.row.rowNumber}`,
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
      state.importBatches.unshift({
        id: nextId(state),
        kind: 'items',
        mode,
        fileName: null,
        createdItems: created,
        updatedItems: updated,
        openingBatches,
        skipped: errors.length,
        createdItemKeys: decisions
          .filter((decision) => decision.action === 'create-item')
          .map((decision) => (decision.row.code ? 'code:' + decision.row.code : 'name:' + decision.row.name + '|unit:' + decision.row.unit)),
        rolledBack: false,
        createdAt: now(),
      });
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
    if (!roleAllowed(currentUser, ['admin', 'warehouse_manager'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
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
      return equipment ? json(equipment) : failure(404, 'Ø§Ù„ØªØ¬Ù‡ÙŠØ² ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯');
    });
  }
  if (equipmentId && pathname === `/api/equipment/${equipmentId}` && method === 'PUT') {
    if (!roleAllowed(currentUser, ['admin', 'warehouse_manager'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
    return mutate((state) => {
      const index = state.equipment.findIndex((entry) => entry.id === equipmentId);
      if (index < 0) return failure(404, 'Ø§Ù„ØªØ¬Ù‡ÙŠØ² ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯');
      const body = readBody(init);
      const existing = state.equipment[index];
      if (body.quantity !== undefined && Number(body.quantity) !== numberValue(existing.quantity)) {
        return failure(409, 'Ù„Ø§ ÙŠÙ…ÙƒÙ† ØªØ¹Ø¯ÙŠÙ„ ÙƒÙ…ÙŠØ© Ø§Ù„ØªØ¬Ù‡ÙŠØ² Ù…Ø¨Ø§Ø´Ø±Ø© â€” Ø§Ø³ØªØ®Ø¯Ù… ØªØ³ÙˆÙŠØ© Ø§Ù„Ø¬Ø±Ø¯ (Ø§Ù„Ø±ØµÙŠØ¯ ÙŠÙØ¯Ø§Ø± Ø¹Ø¨Ø± Ø³Ù†Ø¯Ø§Øª Ø§Ù„Ø­Ø±ÙƒØ©)' );
      }
      state.equipment[index] = equipmentFromInput(state, body, existing);
      addAudit(state, currentUser, 'update', 'equipment', equipmentId);
      return json(state.equipment[index]);
    });
  }
  if (equipmentId && pathname === `/api/equipment/${equipmentId}` && method === 'DELETE') {
    if (!roleAllowed(currentUser, ['admin', 'warehouse_manager'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
    return mutate((state) => {
      state.equipment = state.equipment.filter((entry) => entry.id !== equipmentId);
      addAudit(state, currentUser, 'delete', 'equipment', equipmentId);
      return json({ ok: true });
    });
  }
  if (pathname === '/api/equipment/bulk-import' && method === 'POST') {
    if (!roleAllowed(currentUser, ['admin', 'warehouse_manager'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
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
          errors.push({ row: index + 2, name: '', error: 'Ø§Ø³Ù… Ø§Ù„ØªØ¬Ù‡ÙŠØ² Ù…Ø·Ù„ÙˆØ¨' });
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

  if (pathname === '/api/catalog/import/preview' && method === 'POST') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ© Ù„Ø§Ø³ØªÙŠØ±Ø§Ø¯ Ø§Ù„ÙƒØªØ§Ù„ÙˆØ¬');
    return read((state) => {
      const body = (readBody(init) ?? {}) as { mode?: unknown; items?: unknown; equipment?: unknown };
      const mode = catalogMode(body.mode);
      const context = catalogContext(state, mode);
      const items = validateCatalogItemRows(catalogRows(body.items), context);
      const equipment = validateCatalogEquipmentRows(catalogRows(body.equipment), context);
      return json({
        mode,
        summary: catalogSummary(items, equipment),
        items: items.rows,
        equipment: equipment.rows,
      });
    });
  }
  if (pathname === '/api/catalog/import' && method === 'POST') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ© Ù„Ø§Ø³ØªÙŠØ±Ø§Ø¯ Ø§Ù„ÙƒØªØ§Ù„ÙˆØ¬');
    return mutate((state) => {
      const body = (readBody(init) ?? {}) as { mode?: unknown; items?: unknown; equipment?: unknown };
      const mode = catalogMode(body.mode);
      const context = catalogContext(state, mode);
      const items = validateCatalogItemRows(catalogRows(body.items), context);
      const equipment = validateCatalogEquipmentRows(catalogRows(body.equipment), context);
      const summary = catalogSummary(items, equipment);
      if (summary.totals.error > 0) {
        return json({
          error: 'Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø§Ù„ØªÙ†ÙÙŠØ° Ù…Ø¹ ÙˆØ¬ÙˆØ¯ Ø£Ø®Ø·Ø§Ø¡ ÙÙŠ Ø§Ù„Ù…Ù„Ù. ØµØ­Ù‘Ø­ Ø§Ù„Ø£Ø®Ø·Ø§Ø¡ Ø«Ù… Ø£Ø¹Ø¯ Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø©.',
          code: 'CATALOG_IMPORT_HAS_ERRORS',
          summary,
        }, 409);
      }
      const categories = createCategoryLookup(state.categories);
      let createdItems = 0;
      let updatedItems = 0;
      let createdEquipment = 0;
      let updatedEquipment = 0;
      for (const decision of items.rows) {
        if (decision.action === 'skip' || decision.action === 'error') continue;
        const row = decision.data;
        const categoryId = row.category ? categories.get(normalizeHeader(row.category)) ?? null : null;
        const existing = decision.action === 'update'
          ? state.items.find((entry) => (row.code
            ? text(entry.code) === row.code
            : text(entry.name) === row.name && text(entry.unit) === row.unit))
          : undefined;
        const value: Record<string, unknown> = {
          code: row.code,
          name: row.name,
          categoryId,
          itemType: 'consumable',
          unit: row.unit,
          minStock: row.minStock,
          requiresBatchTracking: row.requiresBatch,
          requiresExpiryTracking: row.requiresExpiry,
          location: row.location,
          supplier: row.supplier,
          notes: row.notes,
          isActive: row.active,
        };
        if (existing) {
          Object.assign(existing, itemFromInput(state, { ...value }, existing));
          updatedItems += 1;
          recordOfflineChange(state, 'item', Number(existing.id), 'update', { name: row.name, quantity: numberValue(existing.currentStock), unit: row.unit });
          addAudit(state, currentUser, 'update', 'item', Number(existing.id));
        } else {
          const item = itemFromInput(state, { ...value, currentStock: 0 }, undefined);
          state.items.push(item);
          createdItems += 1;
          recordOfflineChange(state, 'item', Number(item.id), 'create', { name: row.name, quantity: 0, unit: row.unit });
          addAudit(state, currentUser, 'create', 'item', Number(item.id));
        }
      }
      for (const decision of equipment.rows) {
        if (decision.action === 'skip' || decision.action === 'error') continue;
        const row = decision.data;
        const notes = [row.company ? `Ø§Ù„Ø´Ø±ÙƒØ©: ${row.company}` : null, row.notes].filter(Boolean).join(' | ') || null;
        const existing = decision.action === 'update'
          ? state.equipment.find((entry) => (row.serialNumber
            ? text(entry.serialNumber) === row.serialNumber
            : text(entry.name) === row.name))
          : undefined;
        if (existing) {
          Object.assign(existing, {
            code: row.code,
            name: row.name,
            equipmentType: row.equipmentType,
            model: row.model,
            serialNumber: row.serialNumber,
            minQuantity: row.minQuantity,
            notes,
            isActive: row.active,
            updatedAt: now(),
          });
          updatedEquipment += 1;
          recordOfflineChange(state, 'equipment', Number(existing.id), 'update', { name: row.name });
          addAudit(state, currentUser, 'update', 'equipment', Number(existing.id));
        } else {
          const equipment = {
            id: nextId(state),
            code: row.code,
            name: row.name,
            equipmentType: row.equipmentType,
            model: row.model,
            serialNumber: row.serialNumber,
            unit: row.unit,
            condition: 'good',
            currentHolder: null,
            quantity: 1,
            minQuantity: row.minQuantity,
            notes,
            isActive: row.active,
            createdAt: now(),
            updatedAt: now(),
          };
          state.equipment.push(equipment);
          createdEquipment += 1;
          recordOfflineChange(state, 'equipment', Number(equipment.id), 'create', { name: row.name });
          addAudit(state, currentUser, 'create', 'equipment', Number(equipment.id));
        }
      }
      state.importBatches.unshift({
        id: nextId(state),
        kind: 'catalog',
        mode,
        fileName: null,
        createdItems,
        updatedItems,
        createdEquipment,
        updatedEquipment,
        skipped: summary.totals.skip,
        createdItemKeys: items.rows.filter((decision) => decision.action === 'create').map((decision) => decision.key),
        updatedItemKeys: items.rows.filter((decision) => decision.action === 'update').map((decision) => decision.key),
        rolledBack: false,
        createdAt: now(),
      });
      return json({ ok: true, mode, createdItems, updatedItems, createdEquipment, updatedEquipment, skipped: summary.totals.skip });
    });
  }
  if (pathname === '/api/recipients' && method === 'GET') {
    return read((state) => json(state.recipients.filter((entry) => searchParams.get('includeInactive') === 'true' || entry.isActive !== false)));
  }
  if (pathname === '/api/recipients' && method === 'POST') {
    if (!roleAllowed(currentUser, ['admin', 'warehouse_manager'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
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
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
    return mutate((state) => {
      const recipient = state.recipients.find((entry) => entry.id === recipientId);
      if (!recipient) return failure(404, 'Ø§Ù„Ø¬Ù‡Ø© ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯Ø©');
      const body = readBody(init);
      Object.assign(recipient, { name: text(body.name, text(recipient.name)), notes: body.notes ?? recipient.notes });
      return json(recipient);
    });
  }
  if (recipientId && pathname === `/api/recipients/${recipientId}/toggle` && method === 'PATCH') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
    return mutate((state) => {
      const recipient = state.recipients.find((entry) => entry.id === recipientId);
      if (!recipient) return failure(404, 'Ø§Ù„Ø¬Ù‡Ø© ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯Ø©');
      recipient.isActive = !recipient.isActive;
      return json(recipient);
    });
  }

  if (pathname === '/api/exit-reasons' && method === 'GET') {
    return read((state) => json(state.exitReasons.filter((entry) => searchParams.get('includeInactive') === 'true' || entry.isActive !== false)));
  }
  if (pathname === '/api/exit-reasons' && method === 'POST') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
    return mutate((state) => {
      const body = readBody(init);
      const reason = { id: nextId(state), name: text(body.name), isSystem: false, isActive: true, createdAt: now() };
      state.exitReasons.push(reason);
      return json(reason);
    });
  }
  const reasonId = idFrom(pathname, 'exit-reasons');
  if (reasonId && pathname === `/api/exit-reasons/${reasonId}` && method === 'PUT') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
    return mutate((state) => {
      const reason = state.exitReasons.find((entry) => entry.id === reasonId);
      if (!reason) return failure(404, 'Ø³Ø¨Ø¨ Ø§Ù„Ø¥Ø®Ø±Ø§Ø¬ ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯');
      reason.name = text(readBody(init).name, text(reason.name));
      return json(reason);
    });
  }
  if (reasonId && pathname === `/api/exit-reasons/${reasonId}/toggle` && method === 'PATCH') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
    return mutate((state) => {
      const reason = state.exitReasons.find((entry) => entry.id === reasonId);
      if (!reason) return failure(404, 'Ø³Ø¨Ø¨ Ø§Ù„Ø¥Ø®Ø±Ø§Ø¬ ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯');
      if (reason.isSystem) return failure(400, 'Ù„Ø§ ÙŠÙ…ÙƒÙ† ØªØ¹Ø·ÙŠÙ„ Ø§Ù„Ø£Ø³Ø¨Ø§Ø¨ Ø§Ù„Ø§ÙØªØ±Ø§Ø¶ÙŠØ© Ù„Ù„Ù†Ø¸Ø§Ù…');
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
  if (pathname.startsWith('/api/transactions/') && !pathname.endsWith('/reverse') && method === 'POST') {
    if (!roleAllowed(currentUser, ['admin', 'warehouse_manager'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
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
        if (!custodyEquipment) return failure(404, 'Ø§Ù„ØªØ¬Ù‡ÙŠØ² ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯');
        if (requestedQuantity < 1 || requestedQuantity > numberValue(custodyEquipment.quantity, 1)) {
          return failure(400, 'ÙƒÙ…ÙŠØ© Ø§Ù„Ø¹Ù‡Ø¯Ø© ØºÙŠØ± ØµØ§Ù„Ø­Ø©');
        }
      }
      if (type === 'custody_return') {
        const requestedQuantity = numberValue(body.quantity);
        if (!custodyReturn) return failure(404, 'Ø§Ù„Ø¹Ù‡Ø¯Ø© ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯Ø©');
        if (requestedQuantity < 1 || requestedQuantity > numberValue(custodyReturn.quantity) - numberValue(custodyReturn.returnedQuantity)) {
          return failure(400, 'ÙƒÙ…ÙŠØ© Ø§Ù„Ø¥Ø¹Ø§Ø¯Ø© ØªØªØ¬Ø§ÙˆØ² Ø§Ù„Ù…ØªØ¨Ù‚ÙŠ ÙÙŠ Ø§Ù„Ø¹Ù‡Ø¯Ø©');
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
          if (!equipment) return failure(404, 'Ø§Ù„ØªØ¬Ù‡ÙŠØ² ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯');
          const previousStock = numberValue(equipment.quantity, 0);
          if (newStock < previousStock && newStock < 0) return failure(400, 'Ø§Ù„Ø±ØµÙŠØ¯ Ø§Ù„Ø¬Ø¯ÙŠØ¯ ÙŠØ¬Ø¨ Ø£Ù† ÙŠÙƒÙˆÙ† ØµÙØ±Ù‹Ø§ Ø£Ùˆ Ø£ÙƒØ¨Ø±');
          equipment.quantity = newStock;
          transaction.quantity = Math.abs(newStock - previousStock);
          transaction.details = { previousStock, newStock, delta: newStock - previousStock, deltaType: newStock > previousStock ? 'increase' : 'decrease', openCustody: 0, availableBefore: previousStock, equipmentNameSnap: equipment.name, equipmentModelSnap: equipment.model ?? null, equipmentSerialSnap: equipment.serialNumber ?? null, equipmentConditionSnap: equipment.condition ?? null };
        } else {
          const item = state.items.find((entry) => entry.id === Number(body.itemId));
          if (!item) return failure(404, 'Ø§Ù„Ù…Ø§Ø¯Ø© ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯Ø©');
          const previousStock = numberValue(item.currentStock, 0);
          item.currentStock = newStock;
          const delta = newStock - previousStock;
          const adjustWarehouseId = offlineWarehouseId(state);
          if (delta > 0) {
            const openedBatch = offlineOpenBatch(state, numberValue(item.id), delta, adjustWarehouseId, {
              batchNumber: null,
              expiryDate: null,
              supplier: null,
              deliveryNoteNumber: text(transaction.documentNumber),
              deliveryNoteDate: text(body.documentDate, now().slice(0, 10)),
            });
            recordOfflineChange(state, 'inventory_batch', Number(openedBatch.id), 'create', { ...openedBatch });
          } else if (delta < 0) {
            offlineConsumeBatches(state, numberValue(item.id), Math.abs(delta), adjustWarehouseId);
          }
          transaction.quantity = Math.abs(delta);
          transaction.details = { previousStock, newStock, delta, deltaType: delta > 0 ? 'increase' : 'decrease' };
        }
      }
      const target = state.items.find((item) => item.id === Number(body.itemId));
      const movementWarehouseId = offlineWarehouseId(state);
      if (target && ['in'].includes(type)) {
        target.currentStock = numberValue(target.currentStock) + numberValue(body.quantity);
        const openedBatch = offlineOpenBatch(
          state,
          numberValue(target.id),
          numberValue(body.quantity),
          movementWarehouseId,
          {
            batchNumber: body.batchNumber ? text(body.batchNumber) : null,
            expiryDate: body.expiryDate ? text(body.expiryDate) : null,
            supplier: body.supplier ? text(body.supplier) : null,
            deliveryNoteNumber: text(
              body.deliveryNoteNumber,
              text(body.internalDeliveryNoteNumber, text(transaction.documentNumber)),
            ),
            deliveryNoteDate: text(body.deliveryNoteDate, text(body.documentDate, now().slice(0, 10))),
          },
        );
        recordOfflineChange(state, 'inventory_batch', Number(openedBatch.id), 'create', { ...openedBatch });
      }
      if (target && ['out', 'damage', 'central-return', 'central_return'].includes(type)) {
        target.currentStock = Math.max(0, numberValue(target.currentStock) - numberValue(body.quantity));
        offlineConsumeBatches(state, numberValue(target.id), numberValue(body.quantity), movementWarehouseId);
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
        if (!equipment) return failure(404, 'Ø§Ù„ØªØ¬Ù‡ÙŠØ² ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯');
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
        if (!custody) return failure(404, 'Ø§Ù„Ø¹Ù‡Ø¯Ø© ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯Ø©');
        const quantity = numberValue(body.quantity);
        const outstanding = numberValue(custody.quantity) - numberValue(custody.returnedQuantity);
        if (quantity < 1 || quantity > outstanding) return failure(400, `ÙƒÙ…ÙŠØ© Ø§Ù„Ø¥Ø¹Ø§Ø¯Ø© ØªØªØ¬Ø§ÙˆØ² Ø§Ù„Ù…ØªØ¨Ù‚ÙŠ ÙÙŠ Ø§Ù„Ø¹Ù‡Ø¯Ø© (${outstanding})`);
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
      return transaction ? json(transaction) : failure(404, 'Ø§Ù„Ø³Ù†Ø¯ ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯');
    });
  }
  if (transactionId && pathname === `/api/transactions/${transactionId}/print` && method === 'GET') {
    return read((state) => {
      const transaction = state.transactions.find((entry) => entry.id === transactionId);
      if (!transaction) return failure(404, 'Ø§Ù„Ø³Ù†Ø¯ ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯');
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
            equipmentName: text(raw.equipmentName, text(equipment?.name, 'â€”')),
            serialNumber: text(raw.serialNumber, text(equipment?.serialNumber)) || null,
            quantity,
            returnedQuantity,
            outstandingQuantity: Math.max(0, quantity - returnedQuantity),
            recipientId: raw.recipientId ?? null,
            holderName: text(raw.holderName, text(raw.holderNameSnap, 'â€”')),
            deliveryNoteNumber: text(raw.deliveryNoteNumber, 'â€”'),
            deliveryDate: text(raw.deliveryDate, text(raw.custodyDate, now().slice(0, 10))),
            location: text(raw.location, text(raw.custodyLocation, 'â€”')),
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
      if (!raw || !equipment) return failure(404, 'Ø§Ù„Ø¹Ù‡Ø¯Ø© ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯Ø©');
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
          label: 'Ø¥Ù†Ø´Ø§Ø¡ Ø§Ù„Ø¹Ù‡Ø¯Ø© ÙˆØªØ³Ù„ÙŠÙ… Ø§Ù„ØªØ¬Ù‡ÙŠØ²',
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
            label: returnedSoFar >= quantity ? 'Ø¥Ø¹Ø§Ø¯Ø© ÙƒØ§Ù…Ù„Ø©' : 'Ø¥Ø¹Ø§Ø¯Ø© Ø¬Ø²Ø¦ÙŠØ©',
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
          holderName: text(raw.holderName, text(raw.holderNameSnap, 'â€”')),
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
      if (!rawEquipment) return failure(404, 'Ø§Ù„ØªØ¬Ù‡ÙŠØ² ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯');
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
          holderName: text(custody.holderName, text(custody.holderNameSnap, 'â€”')),
          recipientName: text(custody.recipientName) || null,
          quantity: total,
          returnedQuantity: returned,
          outstandingQuantity: Math.max(0, total - returned),
          deliveryNoteNumber: text(custody.deliveryNoteNumber, 'â€”'),
          deliveryDate: text(custody.deliveryDate, text(custody.custodyDate)),
          location: text(custody.location, 'â€”'),
          status: text(custody.status, 'open'),
        };
      });
      return json({
        equipment: {
          ...rawEquipment,
          id: historyEquipmentId,
          name: text(rawEquipment.name, 'â€”'),
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
          name: state.items.find((item) => item.id === Number(tx.itemId))?.name ?? state.equipment.find((item) => item.id === Number(tx.equipmentId))?.name ?? 'â€”',
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
            entityId: numberValue(item.id), entityType: 'item', entityName: text(item.name, 'â€”'),
            itemName: text(item.name, 'â€”'), message: `Ø§Ù„Ø±ØµÙŠØ¯ ${current} Ø£Ù‚Ù„ Ù…Ù† Ø£Ùˆ ÙŠØ³Ø§ÙˆÙŠ Ø§Ù„Ø­Ø¯ Ø§Ù„Ø£Ø¯Ù†Ù‰ ${minimum}`,
            severity: current === 0 ? 'critical' : 'warning', isRead: false, createdAt: now(), updatedAt: now(),
          });
        }
        if (item.isActive !== false && item.expiryDate) {
          const expiry = new Date(String(item.expiryDate));
          if (!Number.isNaN(expiry.getTime()) && expiry.getTime() <= Date.now() + numberValue(state.settings.expiryAlertDays, 30) * 86_400_000) {
            const expired = expiry.getTime() <= Date.now();
            generated.push({
              id: `near_expiry-${item.id}`, dbId: numberValue(item.id), type: 'near_expiry',
              entityId: numberValue(item.id), entityType: 'item', entityName: text(item.name, 'â€”'),
              itemName: text(item.name, 'â€”'), message: expired ? 'Ø§Ù„Ù…Ø§Ø¯Ø© Ù…Ù†ØªÙ‡ÙŠØ© Ø§Ù„ØµÙ„Ø§Ø­ÙŠØ©' : `ØªÙ†ØªÙ‡ÙŠ Ø§Ù„ØµÙ„Ø§Ø­ÙŠØ© ÙÙŠ ${String(item.expiryDate).slice(0, 10)}`,
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
            entityId: numberValue(equipment.id), entityType: 'equipment', entityName: text(equipment.name, 'â€”'),
            message: condition === 'broken' ? 'Ø§Ù„ØªØ¬Ù‡ÙŠØ² Ù…Ø¹Ø·Ù„ ÙˆÙŠØ­ØªØ§Ø¬ Ø¥Ù„Ù‰ Ù…Ø¹Ø§Ù„Ø¬Ø©' : 'Ø§Ù„ØªØ¬Ù‡ÙŠØ² ÙŠØ­ØªØ§Ø¬ Ø¥Ù„Ù‰ ØµÙŠØ§Ù†Ø© Ø£Ùˆ ÙØ­Øµ',
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

  if (pathname.startsWith('/api/reports/') && !['/api/reports/reconciliation', '/api/reports/stock-by-warehouse', '/api/reports/consolidated', '/api/reports/reorder-suggestions', '/api/reports/kpi', '/api/reports/abc', '/api/reports/transfer-variance'].includes(pathname)) {
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
               equipmentName: text(raw.equipmentName, text(equipment?.name, 'â€”')),
               serialNumber: text(raw.serialNumber, text(equipment?.serialNumber)) || null,
               holderName: text(raw.holderName, text(raw.holderNameSnap, 'â€”')),
               quantity,
               returnedQuantity,
               outstandingQuantity,
               deliveryNoteNumber: text(raw.deliveryNoteNumber, 'â€”'),
               deliveryDate,
               location: text(raw.location, text(raw.custodyLocation, 'â€”')),
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
      return failure(404, 'Ø§Ù„ØªÙ‚Ø±ÙŠØ± ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯');
    });
  }

  if (pathname === '/api/users' && method === 'GET') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
    return read((state) => json(state.users.map(publicUser)));
  }
  if (pathname === '/api/users' && method === 'POST') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
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
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
    return mutate((state) => {
      const user = state.users.find((entry) => entry.id === userId);
      if (!user) return failure(404, 'Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù… ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯');
      Object.assign(user, readBody(init));
      return json(publicUser(user));
    });
  }
  if (userId && pathname === `/api/users/${userId}` && method === 'DELETE') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
    return mutate((state) => {
      state.users = state.users.filter((entry) => entry.id !== userId);
      if (state.currentUserId === userId) state.currentUserId = null;
      return json({ ok: true });
    });
  }

  if (pathname === '/api/settings' && method === 'GET') return read((state) => json(state.settings));
  if (pathname === '/api/settings' && method === 'PUT') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
    return mutate((state) => {
      Object.assign(state.settings, readBody(init), { updatedAt: now() });
      return json(state.settings);
    });
  }
  if (pathname === '/api/settings/profile' && method === 'PATCH') {
    return mutate((state) => {
      const user = state.users.find((entry) => entry.id === currentUser.id);
      if (!user) return failure(404, 'Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù… ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯');
      Object.assign(user, { fullName: text(readBody(init).fullName, user.fullName) });
      return json(publicUser(user));
    });
  }
  if (pathname === '/api/settings/change-password' && method === 'POST') {
    return mutate(async (state) => {
      const user = state.users.find((entry) => entry.id === currentUser.id);
      if (!user) return failure(404, 'Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù… ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯');
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
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
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
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
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
      return failure(400, error instanceof Error ? error.message : 'ØªØ¹Ø°Ø± ÙØ­Øµ Ø§Ù„Ø­Ø²Ù…Ø©');
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
      return failure(400, error instanceof Error ? error.message : 'ØªØ¹Ø°Ø± ØªÙ†ÙÙŠØ° Ø§Ù„Ù…Ø¹Ø§ÙŠÙ†Ø©');
    }
  }
  if (pathname === '/api/backups/restore' && method === 'POST') {
    const body = readBody(init);
    if (body.confirm !== true) return failure(400, 'ÙŠØ¬Ø¨ ØªØ£ÙƒÙŠØ¯ Ø§Ù„Ø§Ø³ØªØ¹Ø§Ø¯Ø© Ø¨Ø¹Ø¯ Ø§Ù„Ù…Ø¹Ø§ÙŠÙ†Ø©');
    const preview = pendingDmePreview ?? await loadPendingPreview();
    if (!preview || preview.token !== text(body.previewToken)) return failure(400, 'Ø§Ù„Ù…Ø¹Ø§ÙŠÙ†Ø© ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯Ø© Ø£Ùˆ Ù…Ù†ØªÙ‡ÙŠØ©');
    if (preview.mode !== (text(body.mode) === 'full' ? 'full' : 'merge')) return failure(400, 'Ù†Ù…Ø· Ø§Ù„Ø§Ø³ØªØ¹Ø§Ø¯Ø© Ù„Ø§ ÙŠØ·Ø§Ø¨Ù‚ Ø§Ù„Ù…Ø¹Ø§ÙŠÙ†Ø©');
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
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
    return read((state) => json({ nodeId: state.nodeIdentity.nodeId, vector: syncVector(state) }));
  }
  if (pathname === '/api/sync/export' && method === 'POST') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
    const body = readBody(init);
    const password = text(body.password);
    if (password.length < 8) return failure(400, 'ÙƒÙ„Ù…Ø© Ù…Ø±ÙˆØ± Ø§Ù„Ø­Ø²Ù…Ø© ÙŠØ¬Ø¨ Ø£Ù† ØªÙƒÙˆÙ† 8 Ø£Ø­Ø±Ù Ø¹Ù„Ù‰ Ø§Ù„Ø£Ù‚Ù„');
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
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
    const body = readBody(init);
    let pkg;
    try {
      pkg = await readDmeSyncPackageInWorker(
        Uint8Array.from(atob(text(body.packageBase64)), (character) => character.charCodeAt(0)),
        text(body.password),
      );
    } catch (error) {
      return failure(400, error instanceof Error ? error.message : 'ØªØ¹Ø°Ø± ÙÙƒ ØªØ´ÙÙŠØ± Ø§Ù„Ø­Ø²Ù…Ø©');
    }
    return mutate((state) => {
      const counts = applyOfflineChanges(state, pkg.changes);
      return json({ mode: 'sync-apply', report: { counts } });
    });
  }

  /* ------------------------------------------------------------------
   * Parity block (Android on-device build).
   *
   * The endpoints below used to exist on the server only, which made the
   * offline build a subset of the browser/desktop builds: units catalog,
   * warehouses, the transfer cycle, import governance, the sync overview,
   * the newer reports and the items export.
   * ------------------------------------------------------------------ */

  // ------------------------------- units -------------------------------
  if (pathname === '/api/units' && method === 'GET') {
    return read((state) => {
      const includeArchived =
        searchParams.get('includeArchived') === '1' && roleAllowed(currentUser, ['admin']);
      const rows = state.units
        .filter((unit) => includeArchived || unit.isActive !== false)
        .sort(
          (a, b) =>
            numberValue(a.sortOrder) - numberValue(b.sortOrder) ||
            text(a.name).localeCompare(text(b.name)),
        );
      return json(rows);
    });
  }
  if (pathname === '/api/units/usage' && method === 'GET') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
    return read((state) => {
      const known = new Set(state.units.filter((unit) => unit.isActive !== false).map((unit) => text(unit.name)));
      const counts = new Map<string, number>();
      for (const item of state.items) {
        const unit = text(item.unit);
        if (!unit) continue;
        counts.set(unit, (counts.get(unit) ?? 0) + 1);
      }
      const rows = [...counts.entries()]
        .map(([unit, count]) => ({ unit, count, known: known.has(unit) }))
        .sort((a, b) => Number(a.known) - Number(b.known) || b.count - a.count || a.unit.localeCompare(b.unit));
      return json(rows);
    });
  }
  if (pathname === '/api/units/seed-defaults' && method === 'POST') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
    return mutate((state) => {
      let created = 0;
      for (const name of DEFAULT_INVENTORY_UNITS) {
        if (state.units.some((unit) => text(unit.name) === name)) continue;
        state.units.push({
          id: nextId(state),
          name,
          symbol: null,
          sortOrder: state.units.length,
          isActive: true,
          isSystem: false,
          createdAt: now(),
          updatedAt: now(),
        });
        created += 1;
      }
      addAudit(state, currentUser, 'seed_defaults', 'unit');
      return json({ created });
    });
  }
  if (pathname === '/api/units/normalize' && method === 'POST') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
    return mutate((state) => {
      const body = readBody(init) ?? {};
      const from = text(body.from).trim();
      const to = text(body.to).trim();
      if (!from || !to) return failure(400, 'from Ùˆ to Ù…Ø·Ù„ÙˆØ¨Ø§Ù†');
      if (from === to) return failure(400, 'Ø§Ù„ÙˆØ­Ø¯Ø© Ø§Ù„Ù…ØµØ¯Ø± ÙˆØ§Ù„Ù‡Ø¯Ù Ù…ØªØ·Ø§Ø¨Ù‚ØªØ§Ù†');
      let updated = 0;
      for (const item of state.items) {
        if (text(item.unit) !== from) continue;
        item.unit = to;
        updated += 1;
        recordOfflineChange(state, 'item', numberValue(item.id), 'update', { unit: to });
      }
      addAudit(state, currentUser, 'normalize_unit', 'unit');
      return json({ updated });
    });
  }
  if (pathname === '/api/units' && method === 'POST') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
    return mutate((state) => {
      const body = readBody(init) ?? {};
      const name = text(body.name).trim();
      if (!name) return failure(400, 'Ø§Ø³Ù… Ø§Ù„ÙˆØ­Ø¯Ø© Ù…Ø·Ù„ÙˆØ¨');
      if (state.units.some((unit) => text(unit.name) === name)) {
        return json({ error: 'ÙŠÙˆØ¬Ø¯ ÙˆØ­Ø¯Ø© Ù…Ø³Ø¬Ù‘Ù„Ø© Ø¨Ù†ÙØ³ Ø§Ù„Ø§Ø³Ù….', code: 'UNIT_NAME_DUPLICATE' }, 409);
      }
      const unit = {
        id: nextId(state),
        name,
        symbol: body.symbol ? text(body.symbol).trim() : null,
        sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : state.units.length,
        isActive: true,
        isSystem: false,
        createdAt: now(),
        updatedAt: now(),
      };
      state.units.push(unit);
      addAudit(state, currentUser, 'create', 'unit', Number(unit.id));
      return json(unit, 201);
    });
  }
  if (pathname.startsWith('/api/units/') && (method === 'PUT' || method === 'DELETE')) {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
    return mutate((state) => {
      const id = Number.parseInt(pathname.split('/').pop() ?? '', 10);
      if (!Number.isSafeInteger(id) || id <= 0) return failure(400, 'Ù…Ø¹Ø±Ù‘Ù Ø§Ù„ÙˆØ­Ø¯Ø© ØºÙŠØ± ØµØ§Ù„Ø­');
      const unit = state.units.find((entry) => numberValue(entry.id) === id);
      if (!unit) return failure(404, 'Ø§Ù„ÙˆØ­Ø¯Ø© ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯Ø©');
      if (method === 'DELETE') {
        const inUse = state.items.filter((item) => text(item.unit) === text(unit.name)).length;
        if (inUse > 0) {
          return json(
            {
              error: `Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø£Ø±Ø´ÙØ© ÙˆØ­Ø¯Ø© Ù…Ø³ØªØ®Ø¯Ù…Ø© ÙÙŠ ${inUse} ØµÙ†Ù. ÙˆØ­Ù‘Ø¯ Ø§Ù„ÙˆØ­Ø¯Ø§Øª Ø£Ùˆ Ø£Ø±Ø´Ù Ø§Ù„Ø£ØµÙ†Ø§Ù Ø£ÙˆÙ„Ù‹Ø§.`,
              code: 'UNIT_IN_USE',
              items: inUse,
            },
            409,
          );
        }
        unit.isActive = false;
        unit.updatedAt = now();
        addAudit(state, currentUser, 'archive', 'unit', id);
        return json(unit);
      }
      const body = readBody(init) ?? {};
      if (body.name !== undefined) {
        const name = text(body.name).trim();
        if (!name) return failure(400, 'Ø§Ø³Ù… Ø§Ù„ÙˆØ­Ø¯Ø© Ù…Ø·Ù„ÙˆØ¨');
        if (state.units.some((other) => text(other.name) === name && numberValue(other.id) !== id)) {
          return json({ error: 'ÙŠÙˆØ¬Ø¯ ÙˆØ­Ø¯Ø© Ù…Ø³Ø¬Ù‘Ù„Ø© Ø¨Ù†ÙØ³ Ø§Ù„Ø§Ø³Ù….', code: 'UNIT_NAME_DUPLICATE' }, 409);
        }
        unit.name = name;
      }
      if (body.symbol !== undefined) unit.symbol = body.symbol ? text(body.symbol).trim() : null;
      if (body.sortOrder !== undefined && Number.isFinite(Number(body.sortOrder))) unit.sortOrder = Number(body.sortOrder);
      if (body.isActive !== undefined) unit.isActive = Boolean(body.isActive);
      unit.updatedAt = now();
      addAudit(state, currentUser, 'update', 'unit', id);
      return json(unit);
    });
  }

  // ----------------------------- warehouses ----------------------------
  if (pathname === '/api/warehouses' && method === 'GET') {
    return read((state) => {
      const includeArchived =
        searchParams.get('includeArchived') === '1' && roleAllowed(currentUser, ['admin']);
      const rows = state.warehouses
        .filter((warehouse) => includeArchived || warehouse.isActive !== false)
        .sort(
          (a, b) =>
            text(a.type).localeCompare(text(b.type)) || text(a.name).localeCompare(text(b.name)),
        );
      return json(rows);
    });
  }
  if (pathname === '/api/warehouses/current' && method === 'GET') {
    return read((state) => json(offlineCurrentWarehouse(state)));
  }
  if (pathname === '/api/warehouses/current' && method === 'POST') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
    return mutate((state) => {
      const body = readBody(init) ?? {};
      const id = numberValue(body.id);
      const warehouse = state.warehouses.find((entry) => numberValue(entry.id) === id);
      if (!warehouse) return failure(404, 'Ø§Ù„Ù…Ø³ØªÙˆØ¯Ø¹ ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯.');
      state.currentWarehouseId = id;
      addAudit(state, currentUser, 'set_current_warehouse', 'warehouse', id);
      return json(offlineWarehouseView(warehouse));
    });
  }
  if (pathname === '/api/warehouses/next-document-number' && method === 'GET') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
    return mutate((state) => {
      const type = text(searchParams.get('type')).trim();
      if (!type) return failure(400, 'type Ù…Ø·Ù„ÙˆØ¨ (Ù…Ø«Ø§Ù„: in).');
      const DOC_TYPES: Record<string, string> = {
        IN: 'IN',
        OUT: 'OUT',
        CUSTODY_OUT: 'CUST',
        CUSTODY_RETURN: 'CUST-RET',
        DAMAGE: 'DMG',
        CENTRAL_RETURN: 'RET',
        ADJUST: 'ADJ',
      };
      const normalized = type.toUpperCase().replace(/\s+/g, '_');
      const documentNumber = offlineNextDocumentNumber(state, DOC_TYPES[normalized] ?? normalized);
      return json({ documentNumber });
    });
  }
  if (pathname === '/api/warehouses' && method === 'POST') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
    return mutate((state) => {
      const body = readBody(init) ?? {};
      const code = text(body.code).trim().toUpperCase();
      const name = text(body.name).trim();
      if (!code || !name) return failure(400, 'Ø§Ù„Ø±Ù…Ø² ÙˆØ§Ù„Ø§Ø³Ù… Ù…Ø·Ù„ÙˆØ¨Ø§Ù†.');
      if (state.warehouses.some((warehouse) => text(warehouse.code) === code)) {
        return json({ error: 'Ø±Ù…Ø² Ø§Ù„Ù…Ø³ØªÙˆØ¯Ø¹ Ù…Ø³Ø¬Ù‘Ù„ Ù…Ø³Ø¨Ù‚Ù‹Ø§.', code: 'WAREHOUSE_CODE_DUPLICATE' }, 409);
      }
      const warehouse = {
        id: nextId(state),
        code,
        name,
        type: text(body.type) === 'central' ? 'central' : 'branch',
        notes: body.notes ? text(body.notes).trim() : null,
        isActive: true,
        createdAt: now(),
        updatedAt: now(),
      };
      state.warehouses.push(warehouse);
      addAudit(state, currentUser, 'create', 'warehouse', Number(warehouse.id));
      return json(warehouse, 201);
    });
  }
  if (pathname.startsWith('/api/warehouses/') && method === 'PUT') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
    return mutate((state) => {
      const id = Number.parseInt(pathname.split('/').pop() ?? '', 10);
      if (!Number.isSafeInteger(id) || id <= 0) return failure(400, 'Ù…Ø¹Ø±Ù‘Ù Ø§Ù„Ù…Ø³ØªÙˆØ¯Ø¹ ØºÙŠØ± ØµØ§Ù„Ø­.');
      const warehouse = state.warehouses.find((entry) => numberValue(entry.id) === id);
      if (!warehouse) return failure(404, 'Ø§Ù„Ù…Ø³ØªÙˆØ¯Ø¹ ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯.');
      const body = readBody(init) ?? {};
      if (body.name !== undefined) {
        const name = text(body.name).trim();
        if (!name) return failure(400, 'Ø§Ù„Ø§Ø³Ù… Ù…Ø·Ù„ÙˆØ¨.');
        warehouse.name = name;
      }
      if (body.notes !== undefined) warehouse.notes = body.notes ? text(body.notes).trim() : null;
      if (body.type !== undefined) warehouse.type = text(body.type) === 'central' ? 'central' : 'branch';
      if (body.isActive !== undefined) warehouse.isActive = Boolean(body.isActive);
      warehouse.updatedAt = now();
      addAudit(state, currentUser, 'update', 'warehouse', id);
      return json(warehouse);
    });
  }

  // ------------------------------ transfers ----------------------------
  if (pathname === '/api/transfers' && method === 'GET') {
    return read((state) => {
      const status = text(searchParams.get('status')).trim();
      const limit = Math.min(500, Math.max(1, numberValue(searchParams.get('limit'), 100)));
      const rows = state.transfers
        .filter((transfer) => !status || text(transfer.status) === status)
        .sort((a, b) => text(b.createdAt).localeCompare(text(a.createdAt)))
        .slice(0, limit);
      return json(rows);
    });
  }
  if (pathname.startsWith('/api/transfers/') && method === 'POST') {
    if (!roleAllowed(currentUser, ['admin', 'warehouse_manager'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
    return mutate((state) => {
      const segments = pathname.split('/').filter(Boolean);
      const rawId = segments[2];
      const action = segments[3] ?? '';
      const id = Number.parseInt(rawId ?? '', 10);
      if (!Number.isSafeInteger(id) || id <= 0) return failure(400, 'Ù…Ø¹Ø±Ù‘Ù Ø§Ù„ØªØ­ÙˆÙŠÙ„ ØºÙŠØ± ØµØ§Ù„Ø­.');
      const transfer = state.transfers.find((entry) => numberValue(entry.id) === id);
      if (!transfer) return failure(404, 'Ø§Ù„ØªØ­ÙˆÙŠÙ„ ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯.');
      const body = readBody(init) ?? {};
      const status = text(transfer.status);
      const openStatuses = ['requested', 'issued'];
      const today = now().slice(0, 10);

      if (action === 'issue') {
        if (status !== 'requested') {
          return json({ error: `Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø§Ù„Ø¥Ø±Ø³Ø§Ù„. Ø§Ù„Ø­Ø§Ù„Ø© Ø§Ù„Ø­Ø§Ù„ÙŠØ© Â«${status}Â».`, code: 'INVALID_TRANSITION' }, 409);
        }
        const lines = state.transferLines.filter((line) => numberValue(line.transferId) === id);
        if (lines.length === 0) {
          return json({ error: 'لا توجد بنود في التحويل.', code: 'NO_LINES' }, 409);
        }
        const fromWarehouseId = numberValue(transfer.fromWarehouseId, offlineWarehouseId(state));
        // pre-flight: the whole transfer must be satisfiable, otherwise nothing is written
        const shortages = lines
          .map((line) => {
            const required = numberValue(line.quantity);
            const available = offlineWarehouseBalance(state, numberValue(line.itemId), fromWarehouseId);
            return { itemId: numberValue(line.itemId), required, available };
          })
          .filter((entry) => entry.available < entry.required);
        if (shortages.length > 0) {
          return json(
            {
              error: 'لا يمكن الإرسال: الرصيد في مستودع المصدر غير كافٍ.',
              code: 'INSUFFICIENT_STOCK',
              shortages,
            },
            409,
          );
        }
        for (const line of lines) {
          offlineApplyTransferOut(
            state,
            numberValue(line.itemId),
            numberValue(line.quantity),
            fromWarehouseId,
            text(transfer.code),
            today,
            currentUser,
          );
        }
        transfer.status = 'issued';
        transfer.issuedAt = now();
        transfer.updatedAt = now();
        addAudit(state, currentUser, 'issue', 'transfer', id);
        return json(offlineTransferSummary(state, id));
      }

      if (action === 'receive') {
        const provisional = Boolean(body.provisional);
        if (status !== 'issued' && !provisional) {
          return json({ error: 'Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø§Ù„Ø§Ø³ØªÙ„Ø§Ù…. ÙŠØ¬Ø¨ Ø§Ù„Ø¥Ø±Ø³Ø§Ù„ Ø£ÙˆÙ„Ù‹Ø§.', code: 'INVALID_TRANSITION' }, 409);
        }
        if (status === 'received' || status === 'closed') {
          return json({ error: 'ØªÙ… Ø§Ø³ØªÙ„Ø§Ù… Ù‡Ø°Ø§ Ø§Ù„ØªØ­ÙˆÙŠÙ„ Ù…Ø³Ø¨Ù‚Ù‹Ø§.', code: 'ALREADY_RECEIVED' }, 409);
        }
        const deliveryNoteNumber = text(body.deliveryNoteNumber, text(transfer.deliveryNoteNumber, text(transfer.code)));
        const toWarehouseId = numberValue(transfer.toWarehouseId, offlineWarehouseId(state));
        const lines = state.transferLines.filter((line) => numberValue(line.transferId) === id);
        const rawReceived = Array.isArray(body?.lines) ? (body.lines as Array<Record<string, unknown>>) : [];
        const receivedByLine = new Map<number, { quantity: number; reason: string | null }>();
        for (const entry of rawReceived) {
          const lineId = numberValue(entry?.lineId);
          const quantity = numberValue(entry?.receivedQuantity, -1);
          if (lineId <= 0 || quantity < 0) continue;
          receivedByLine.set(lineId, { quantity, reason: entry?.varianceReason ? text(entry.varianceReason).trim() : null });
        }
        for (const line of lines) {
          const counted = receivedByLine.get(numberValue(line.id));
          if (counted) {
            line.receivedQuantity = counted.quantity;
            line.variance = counted.quantity - numberValue(line.quantity);
            line.varianceReason = counted.reason;
          }
          offlineApplyTransferIn(
            state,
            numberValue(line.itemId),
            receivedByLine.get(numberValue(line.id))?.quantity ?? numberValue(line.quantity),
            toWarehouseId,
            deliveryNoteNumber,
            today,
            line.batchNumber ? text(line.batchNumber) : null,
            line.expiryDate ? text(line.expiryDate) : null,
            currentUser,
          );
        }
        transfer.status = 'received';
        transfer.receivedAt = now();
        transfer.closedAt = now();
        transfer.deliveryNoteNumber = deliveryNoteNumber;
        transfer.provisional = provisional;
        transfer.updatedAt = now();
        addAudit(state, currentUser, 'receive', 'transfer', id);
        return json(offlineTransferSummary(state, id));
      }

      if (action === 'reject') {
        if (!openStatuses.includes(status)) {
          return json({ error: 'Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø±ÙØ¶ Ø§Ù„ØªØ­ÙˆÙŠÙ„ ÙÙŠ Ø­Ø§Ù„ØªÙ‡.', code: 'INVALID_TRANSITION' }, 409);
        }
        transfer.status = 'rejected';
        transfer.rejectionReason = body.reason ? text(body.reason).trim() : null;
        transfer.updatedAt = now();
        addAudit(state, currentUser, 'reject', 'transfer', id);
        return json(offlineTransferSummary(state, id));
      }

      if (action === 'cancel') {
        if (!openStatuses.includes(status)) {
          return json({ error: 'Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø¥Ù„ØºØ§Ø¡ Ø§Ù„ØªØ­ÙˆÙŠÙ„ ÙÙŠ Ø­Ø§Ù„ØªÙ‡.', code: 'INVALID_TRANSITION' }, 409);
        }
        transfer.status = 'cancelled';
        transfer.updatedAt = now();
        addAudit(state, currentUser, 'cancel', 'transfer', id);
        return json(offlineTransferSummary(state, id));
      }

      return failure(404, 'Ø¥Ø¬Ø±Ø§Ø¡ Ø§Ù„ØªØ­ÙˆÙŠÙ„ ØºÙŠØ± Ù…Ø¹Ø±ÙˆÙ.');
    });
  }
  if (pathname === '/api/transfers' && method === 'POST') {
    if (!roleAllowed(currentUser, ['admin', 'warehouse_manager'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
    return mutate((state) => {
      const body = readBody(init) ?? {};
      const current = offlineCurrentWarehouse(state);
      if (!current) return json({ error: 'Ù„Ø§ ÙŠÙˆØ¬Ø¯ Ù…Ø³ØªÙˆØ¯Ø¹ Ù…Ø±ÙƒØ²ÙŠ Ù…Ø¹Ø±Ù‘Ù.', code: 'NO_WAREHOUSE' }, 409);
      const rawItems = Array.isArray(body.items) ? body.items : [];
      if (rawItems.length === 0) return failure(400, 'ÙŠØ¬Ø¨ Ø¥Ø¶Ø§ÙØ© Ø¨Ù†Ø¯ ÙˆØ§Ø­Ø¯ Ø¹Ù„Ù‰ Ø§Ù„Ø£Ù‚Ù„.');
      const toWarehouseId = numberValue(body.toWarehouseId, current.id);
      const fromWarehouseId = numberValue(body.fromWarehouseId, current.id);
      if (toWarehouseId === fromWarehouseId) return failure(400, 'Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø§Ù„ØªØ­ÙˆÙŠÙ„ Ø¥Ù„Ù‰ Ù†ÙØ³ Ø§Ù„Ù…Ø³ØªÙˆØ¯Ø¹.');
      const transfer = {
        id: nextId(state),
        code: offlineNextDocumentNumber(state, 'TRF') ?? `TRF-${Date.now()}`,
        status: 'requested',
        fromWarehouseId,
        toWarehouseId,
        requestedByUserId: currentUser?.id ?? null,
        requestedByName: currentUser?.fullName ?? null,
        notes: body.notes ? text(body.notes).trim() : null,
        rejectionReason: null,
        deliveryNoteNumber: null,
        provisional: false,
        issuedAt: null,
        receivedAt: null,
        closedAt: null,
        createdAt: now(),
        updatedAt: now(),
      };
      const parsedLines = (rawItems as Array<Record<string, unknown>>).map((line) => ({
        itemId: numberValue(line?.itemId),
        quantity: numberValue(line?.quantity),
        unit: line?.unit ? text(line.unit) : null,
        batchNumber: line?.batchNumber ? text(line.batchNumber) : null,
        expiryDate: line?.expiryDate ? text(line.expiryDate) : null,
        notes: line?.notes ? text(line.notes) : null,
      }));
      if (parsedLines.some((line) => line.itemId <= 0 || line.quantity <= 0)) {
        return failure(400, 'بيانات بند غير صحيحة: الكمية ورقم الصنف مطلوبان.');
      }
      if (parsedLines.some((line) => !state.items.some((item) => numberValue(item.id) === line.itemId))) {
        return failure(400, 'أحد الأصناف المطلوب تحويلها غير موجود.');
      }
      for (const line of parsedLines) {
        const itemId = line.itemId;
        const quantity = line.quantity;
        if (itemId <= 0 || quantity <= 0) return failure(400, 'Ø¨ÙŠØ§Ù†Ø§Øª Ø¨Ù†Ø¯ ØºÙŠØ± ØµØ­ÙŠØ­Ø©: Ø§Ù„ÙƒÙ…ÙŠØ© ÙˆØ±Ù‚Ù… Ø§Ù„ØµÙ†Ù Ù…Ø·Ù„ÙˆØ¨Ø§Ù†.');
        state.transferLines.push({
          id: nextId(state),
          transferId: transfer.id,
          itemId,
          quantity,
          unit: line?.unit ? text(line.unit) : null,
          batchNumber: line?.batchNumber ? text(line.batchNumber) : null,
          expiryDate: line?.expiryDate ? text(line.expiryDate) : null,
          notes: line?.notes ? text(line.notes) : null,
        });
      }
      state.transfers.push(transfer);
      recordOfflineChange(state, 'transfer', Number(transfer.id), 'create', { code: transfer.code, status: transfer.status });
      addAudit(state, currentUser, 'create', 'transfer', Number(transfer.id));
      return json(offlineTransferSummary(state, Number(transfer.id)), 201);
    });
  }
  if (pathname.startsWith('/api/transfers/') && method === 'GET') {
    return read((state) => {
      const id = Number.parseInt(pathname.split('/').pop() ?? '', 10);
      if (!Number.isSafeInteger(id) || id <= 0) return failure(400, 'Ù…Ø¹Ø±Ù‘Ù Ø§Ù„ØªØ­ÙˆÙŠÙ„ ØºÙŠØ± ØµØ§Ù„Ø­.');
      const summary = offlineTransferSummary(state, id);
      return summary ? json(summary) : failure(404, 'Ø§Ù„ØªØ­ÙˆÙŠÙ„ ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯.');
    });
  }

  // -------------------------- import governance ------------------------
  if (pathname === '/api/import-batches' && method === 'GET') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
    return read((state) => {
      const limit = Math.min(500, Math.max(1, numberValue(searchParams.get('limit'), 100)));
      const rows = [...state.importBatches]
        .sort((a, b) => text(b.createdAt).localeCompare(text(a.createdAt)))
        .slice(0, limit);
      return json(rows);
    });
  }
  if (pathname.startsWith('/api/import-batches/') && pathname.endsWith('/rollback') && method === 'POST') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
    return mutate((state) => {
      const id = Number.parseInt(pathname.split('/')[3] ?? '', 10);
      if (!Number.isSafeInteger(id) || id <= 0) return failure(400, 'Ù…Ø¹Ø±Ù‘Ù Ø¯ÙØ¹Ø© Ø§Ù„Ø§Ø³ØªÙŠØ±Ø§Ø¯ ØºÙŠØ± ØµØ§Ù„Ø­.');
      const batch = state.importBatches.find((entry) => numberValue(entry.id) === id);
      if (!batch) return failure(404, 'Ø¯ÙØ¹Ø© Ø§Ù„Ø§Ø³ØªÙŠØ±Ø§Ø¯ ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯Ø©.');
      if (batch.rolledBack) return json({ error: 'ØªÙ… Ø§Ù„ØªØ±Ø§Ø¬Ø¹ Ø¹Ù† Ù‡Ø°Ù‡ Ø§Ù„Ø¯ÙØ¹Ø© Ù…Ø³Ø¨Ù‚Ù‹Ø§.', code: 'ALREADY_ROLLED_BACK' }, 409);
      const createdKeys = Array.isArray(batch.createdItemKeys) ? (batch.createdItemKeys as string[]) : [];
      let removed = 0;
      for (const key of createdKeys) {
        const code = key.startsWith('code:') ? key.slice(5) : null;
        const name = code ? null : key.replace(/^name:/, '').split('|unit:')[0];
        const item = state.items.find((entry) =>
          code ? text(entry.code) === code : text(entry.name) === name && key.endsWith(`unit:${text(entry.unit)}`),
        );
        if (!item) continue;
        state.tombstones.push({ entityType: 'item', localId: numberValue(item.id), deletedAt: now(), reason: 'import-rollback' });
        recordOfflineChange(state, 'item', numberValue(item.id), 'delete', { name: text(item.name) });
        item.isActive = false;
        removed += 1;
      }
      batch.rolledBack = true;
      batch.rolledBackAt = now();
      addAudit(state, currentUser, 'rollback', 'import_batch', id);
      return json({ ok: true, removed });
    });
  }

  // ------------------------------ sync overview ------------------------
  if (pathname === '/api/sync/overview' && method === 'GET') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
    return read((state) => {
      const pending = state.outbox.filter((entry) => text(entry.status) === 'pending').length;
      const exported = state.outbox.filter((entry) => text(entry.status) === 'exported').length;
      const openConflicts = state.conflictQueue.filter((entry) => text(entry.status) === 'open').length;
      const rejected = state.inbox.filter((entry) => text(entry.status) === 'rejected').length;
      return json({
        node: {
          nodeId: state.nodeIdentity.nodeId ?? null,
          installationId: state.nodeIdentity.installationId ?? null,
          nodeType: state.nodeIdentity.nodeType ?? null,
        },
        warehouse: offlineCurrentWarehouse(state),
        peers: {
          trusted: 0,
          cursors: state.syncCursors.map((cursor) => ({
            peerNodeId: cursor.peerNodeId ?? null,
            vector: cursor.vector ?? null,
            updatedAt: cursor.updatedAt ?? null,
          })),
        },
        outbox: { pending, exported },
        conflicts: { open: openConflicts },
        inbox: { rejected },
        generatedAt: now(),
      });
    });
  }

  // ------------------------------ reports ------------------------------
  if (pathname === '/api/reports/reconciliation' && method === 'GET') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
    return read((state) => {
      const rows = state.items
        .filter((item) => item.isActive !== false)
        .map((item) => {
          const batches = state.inventoryBatches.filter(
            (batch) => numberValue(batch.itemId) === numberValue(item.id),
          );
          const batchTotal = batches.reduce((sum, batch) => sum + numberValue(batch.remainingQuantity), 0);
          const currentStock = numberValue(item.currentStock);
          return {
            id: numberValue(item.id),
            code: text(item.code) || null,
            name: text(item.name),
            unit: text(item.unit),
            currentStock,
            batchTotal,
            batchCount: batches.length,
            delta: currentStock - batchTotal,
          };
        });
      const mismatches = rows.filter((row) => row.delta !== 0).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
      return json({ checked: rows.length, mismatches: mismatches.length, items: mismatches, generatedAt: now() });
    });
  }
  if (pathname === '/api/reports/stock-by-warehouse' && method === 'GET') {
    return read((state) => {
      const itemsById = new Map(state.items.map((item) => [numberValue(item.id), item]));
      const warehousesById = new Map(state.warehouses.map((warehouse) => [numberValue(warehouse.id), warehouse]));
      const fallbackWarehouseId = offlineWarehouseId(state);
      const grouped = new Map<string, { warehouseId: number; itemId: number; quantity: number }>();
      for (const batch of state.inventoryBatches) {
        const quantity = numberValue(batch.remainingQuantity);
        if (quantity === 0) continue;
        const warehouseId = numberValue(batch.warehouseId, fallbackWarehouseId);
        const itemId = numberValue(batch.itemId);
        const key = `${warehouseId}:${itemId}`;
        const entry = grouped.get(key) ?? { warehouseId, itemId, quantity: 0 };
        entry.quantity += quantity;
        grouped.set(key, entry);
      }
      const positions = [...grouped.values()]
        .map((entry) => ({
          warehouseId: entry.warehouseId,
          warehouse: offlineWarehouseView(warehousesById.get(entry.warehouseId)),
          itemId: entry.itemId,
          item: (() => {
            const item = itemsById.get(entry.itemId);
            return item
              ? { id: numberValue(item.id), code: text(item.code) || null, name: text(item.name), unit: text(item.unit) }
              : null;
          })(),
          quantity: entry.quantity,
        }))
        .filter((row) => row.item && row.quantity !== 0)
        .sort(
          (a, b) =>
            String(a.warehouse?.code ?? '').localeCompare(String(b.warehouse?.code ?? '')) ||
            String(a.item?.name ?? '').localeCompare(String(b.item?.name ?? '')),
        );
      const byWarehouse = [...positions
        .reduce((acc, row) => {
          const entry = acc.get(row.warehouseId) ?? {
            warehouseId: row.warehouseId,
            warehouse: row.warehouse,
            lines: 0,
            quantity: 0,
          };
          entry.lines += 1;
          entry.quantity += row.quantity;
          acc.set(row.warehouseId, entry);
          return acc;
        }, new Map<number, { warehouseId: number; warehouse: unknown; lines: number; quantity: number }>())
        .values()];
      return json({ positions, byWarehouse, generatedAt: now() });
    });
  }
  if (pathname === '/api/reports/consolidated' && method === 'GET') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
    return read((state) => {
      const minById = new Map(
        state.items.filter((item) => item.isActive !== false).map((item) => [numberValue(item.id), numberValue(item.minStock)]),
      );
      const fallbackWarehouseId = offlineWarehouseId(state);
      const perWarehouse = new Map<number, { warehouseId: number; warehouse: unknown; lines: number; quantity: number; belowMin: number }>();
      for (const warehouse of state.warehouses) {
        perWarehouse.set(numberValue(warehouse.id), {
          warehouseId: numberValue(warehouse.id),
          warehouse: offlineWarehouseView(warehouse),
          lines: 0,
          quantity: 0,
          belowMin: 0,
        });
      }
      for (const batch of state.inventoryBatches) {
        const quantity = numberValue(batch.remainingQuantity);
        if (quantity === 0) continue;
        const warehouseId = numberValue(batch.warehouseId, fallbackWarehouseId);
        const entry =
          perWarehouse.get(warehouseId) ??
          { warehouseId, warehouse: null, lines: 0, quantity: 0, belowMin: 0 };
        entry.lines += 1;
        entry.quantity += quantity;
        const min = minById.get(numberValue(batch.itemId)) ?? 0;
        if (min > 0 && quantity < min) entry.belowMin += 1;
        perWarehouse.set(warehouseId, entry);
      }
      const warehouses = [...perWarehouse.values()].sort((a, b) =>
        String((a.warehouse as { code?: string } | null)?.code ?? '').localeCompare(
          String((b.warehouse as { code?: string } | null)?.code ?? ''),
        ),
      );
      return json({
        totals: {
          items: state.items.filter((item) => item.isActive !== false).length,
          equipment: state.equipment.length,
          quantity: warehouses.reduce((sum, warehouse) => sum + warehouse.quantity, 0),
          belowMin: warehouses.reduce((sum, warehouse) => sum + warehouse.belowMin, 0),
          warehouses: warehouses.length,
        },
        warehouses,
        generatedAt: now(),
      });
    });
  }

  // ---------------------------- items export ---------------------------
  if (pathname === '/api/items/export' && method === 'GET') {
    if (!roleAllowed(currentUser, ['admin', 'warehouse_manager'])) return failure(403, 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ©');
    return read((state) => {
      const categoryById = new Map(state.categories.map((category) => [numberValue(category.id), text(category.name)]));
      return json({
        version: INVENTORY_TEMPLATE_VERSION,
        exportedAt: now(),
        items: state.items
          .filter((item) => item.isActive !== false)
          .map((item) => ({
            code: text(item.code) || '',
            name: text(item.name),
            unit: text(item.unit),
            categoryName: item.categoryId ? categoryById.get(numberValue(item.categoryId)) ?? '' : '',
            minStock: numberValue(item.minStock),
            location: text(item.location) || '',
            notes: text(item.notes) || '',
          })),
        openingBatches: state.inventoryBatches
          .filter((batch) => {
            if (numberValue(batch.remainingQuantity) <= 0) return false;
            const owner = state.items.find((entry) => numberValue(entry.id) === numberValue(batch.itemId));
            if (!owner) return false;
            return owner.isActive !== false;
          })
          .map((batch) => {
            const item = state.items.find((entry) => numberValue(entry.id) === numberValue(batch.itemId));
            return {
              code: item ? text(item.code) || '' : '',
              quantity: numberValue(batch.remainingQuantity),
              batchNumber: text(batch.batchNumber) || '',
              expiryDate: text(batch.expiryDate) || '',
              supplier: text(batch.supplier) || '',
              deliveryNoteNumber: text(batch.deliveryNoteNumber) || '',
              deliveryNoteDate: text(batch.deliveryNoteDate) || '',
            };
          }),
      });
    });
  }

  /* ---------------- audit P0/P1: counting, reversal, variance, KPIs ---------------- */

  // -------- cycle counting --------
  if (pathname === '/api/counts' && method === 'GET') {
    if (!roleAllowed(currentUser, ['admin', 'warehouse_manager'])) return failure(403, 'ليس لديك صلاحية');
    return read((state) => {
      const limit = Math.min(200, Math.max(1, numberValue(searchParams.get('limit'), 100)));
      const rows = [...state.countSessions]
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, limit)
        .map((session) => ({ ...session, lines: undefined }));
      return json(rows);
    });
  }
  if (pathname === '/api/counts' && method === 'POST') {
    if (!roleAllowed(currentUser, ['admin', 'warehouse_manager'])) return failure(403, 'ليس لديك صلاحية');
    return mutate((state) => {
      const body = readBody(init) ?? {};
      const warehouse = offlineCurrentWarehouse(state);
      if (!warehouse) return json({ error: 'لا يوجد مستودع معرّف.', code: 'NO_WAREHOUSE' }, 409);
      const rows = state.items.filter((item) => item.isActive !== false && text(item.itemType, 'item') === 'item');
      if (rows.length === 0) return json({ error: 'لا توجد أصناف للجرد.', code: 'COUNT_NO_ITEMS' }, 409);
      const session = {
        id: nextId(state),
        code: offlineNextDocumentNumber(state, 'CNT') ?? `CNT-${Date.now()}`,
        status: 'open',
        warehouseId: warehouse.id,
        scope: text(body.scope, 'full'),
        blindCount: body.blindCount === undefined ? true : Boolean(body.blindCount),
        notes: body.notes ? text(body.notes).trim() : null,
        createdByUserId: currentUser?.id ?? null,
        createdByName: currentUser?.fullName ?? null,
        approvedByUserId: null,
        approvedByName: null,
        linesCount: rows.length,
        countedLines: 0,
        varianceLines: 0,
        totalVariance: 0,
        startedAt: now(),
        approvedAt: null,
        cancelledAt: null,
        createdAt: now(),
        updatedAt: now(),
      };
      state.countSessions.unshift(session);
      for (const item of rows) {
        state.countLines.push({
          id: nextId(state),
          sessionId: session.id,
          itemId: numberValue(item.id),
          itemCode: text(item.code) || null,
          itemName: text(item.name),
          unit: text(item.unit),
          binCode: text(item.binCode) || null,
          systemQuantity: numberValue(item.currentStock),
          countedQuantity: null,
          variance: null,
          varianceReason: null,
          countedByName: null,
          countedAt: null,
          createdAt: now(),
        });
      }
      addAudit(state, currentUser, 'create', 'count_session', Number(session.id));
      return json(offlineCountSession(state, Number(session.id)), 201);
    });
  }
  if (pathname.startsWith('/api/counts/') && pathname.endsWith('/entries') && method === 'POST') {
    if (!roleAllowed(currentUser, ['admin', 'warehouse_manager'])) return failure(403, 'ليس لديك صلاحية');
    return mutate((state) => {
      const id = Number.parseInt(pathname.split('/')[3] ?? '', 10);
      const session = state.countSessions.find((entry) => numberValue(entry.id) === id);
      if (!session) return failure(404, 'جلسة الجرد غير موجودة.');
      if (text(session.status) !== 'open') return json({ error: 'الجلسة ليست مفتوحة.', code: 'COUNT_NOT_OPEN' }, 409);
      const body = readBody(init) ?? {};
      const entries = Array.isArray(body.entries) ? body.entries : [];
      for (const entry of entries as Array<Record<string, unknown>>) {
        const line = state.countLines.find(
          (candidate) => numberValue(candidate.id) === numberValue(entry?.lineId) && numberValue(candidate.sessionId) === id,
        );
        if (!line) continue;
        const counted = entry?.countedQuantity === null || entry?.countedQuantity === undefined || entry?.countedQuantity === ''
          ? null
          : Math.max(0, Math.trunc(numberValue(entry.countedQuantity)));
        line.countedQuantity = counted;
        line.variance = counted === null ? null : counted - numberValue(line.systemQuantity);
        if (entry?.varianceReason) line.varianceReason = text(entry.varianceReason).trim();
        line.countedByName = currentUser?.fullName ?? null;
        line.countedAt = now();
      }
      offlineRefreshCount(state, id);
      return json(offlineCountSession(state, id));
    });
  }
  if (pathname.startsWith('/api/counts/') && pathname.endsWith('/approve') && method === 'POST') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'ليس لديك صلاحية');
    return mutate((state) => {
      const id = Number.parseInt(pathname.split('/')[3] ?? '', 10);
      const session = state.countSessions.find((entry) => numberValue(entry.id) === id);
      if (!session) return failure(404, 'جلسة الجرد غير موجودة.');
      if (text(session.status) !== 'open') return json({ error: 'الجلسة ليست مفتوحة.', code: 'COUNT_NOT_OPEN' }, 409);
      const lines = state.countLines.filter((line) => numberValue(line.sessionId) === id);
      const uncounted = lines.filter((line) => line.countedQuantity === null || line.countedQuantity === undefined);
      if (uncounted.length > 0) {
        return json({ error: `لا يمكن الاعتماد: ${uncounted.length} سطرًا لم يُجرَد بعد.`, code: 'COUNT_INCOMPLETE' }, 409);
      }
      const missing = lines.find((line) => numberValue(line.variance) !== 0 && !text(line.varianceReason).trim());
      if (missing) {
        return json(
          { error: `يجب تسجيل سبب لكل فرق (الصنف: ${text(missing.itemName)}).`, code: 'COUNT_VARIANCE_REASON_REQUIRED' },
          409,
        );
      }
      let posted = 0;
      for (const line of lines) {
        const variance = numberValue(line.variance);
        if (variance === 0) continue;
        const item = state.items.find((candidate) => numberValue(candidate.id) === numberValue(line.itemId));
        if (!item) continue;
        const warehouseId = numberValue(session.warehouseId, offlineWarehouseId(state));
        const delta = variance;
        item.currentStock = Math.max(0, numberValue(item.currentStock) + delta);
        if (delta > 0) {
          const batch = offlineOpenBatch(state, numberValue(item.id), delta, warehouseId, {
            batchNumber: null,
            expiryDate: null,
            supplier: null,
            deliveryNoteNumber: text(session.code),
            deliveryNoteDate: now().slice(0, 10),
          });
          recordOfflineChange(state, 'inventory_batch', Number(batch.id), 'create', { ...batch });
        } else {
          offlineConsumeBatches(state, numberValue(item.id), Math.abs(delta), warehouseId);
        }
        const transaction = {
          id: nextId(state),
          type: 'adjust',
          documentNumber: `${text(session.code)}-${numberValue(line.id)}`,
          transactionDate: now().slice(0, 10),
          itemId: numberValue(item.id),
          quantity: Math.abs(delta),
          notes: `جرد دوري ${text(session.code)}: ${text(line.varianceReason)}`,
          reason: text(line.varianceReason),
          createdBy: currentUser?.id ?? null,
          createdAt: now(),
          warehouseId,
          details: { previousStock: numberValue(line.systemQuantity), newStock: numberValue(line.countedQuantity), delta },
        };
        state.transactions.unshift(transaction);
        recordOfflineChange(state, 'transaction', Number(transaction.id), 'create', {
          type: 'adjust',
          documentNumber: transaction.documentNumber,
          itemId: transaction.itemId,
          quantity: transaction.quantity,
        });
        recordOfflineChange(state, 'item', numberValue(item.id), 'update', {
          name: text(item.name),
          quantity: numberValue(item.currentStock),
        });
        posted += 1;
      }
      session.status = 'approved';
      session.approvedAt = now();
      session.approvedByUserId = currentUser?.id ?? null;
      session.approvedByName = currentUser?.fullName ?? null;
      session.updatedAt = now();
      addAudit(state, currentUser, 'approve', 'count_session', id);
      return json({ ok: true, posted, session: offlineCountSession(state, id) });
    });
  }
  if (pathname.startsWith('/api/counts/') && pathname.endsWith('/cancel') && method === 'POST') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'ليس لديك صلاحية');
    return mutate((state) => {
      const id = Number.parseInt(pathname.split('/')[3] ?? '', 10);
      const session = state.countSessions.find((entry) => numberValue(entry.id) === id);
      if (!session) return failure(404, 'جلسة الجرد غير موجودة.');
      if (text(session.status) !== 'open') return json({ error: 'الجلسة ليست مفتوحة.', code: 'COUNT_NOT_OPEN' }, 409);
      session.status = 'cancelled';
      session.cancelledAt = now();
      session.updatedAt = now();
      addAudit(state, currentUser, 'cancel', 'count_session', id);
      return json(session);
    });
  }
  if (pathname.startsWith('/api/counts/') && method === 'GET') {
    return read((state) => {
      const id = Number.parseInt(pathname.split('/').pop() ?? '', 10);
      const session = offlineCountSession(state, id);
      return session ? json(session) : failure(404, 'جلسة الجرد غير موجودة.');
    });
  }

  // -------- reversal --------
  if (/^\/api\/transactions\/\d+\/reverse$/.test(pathname) && method === 'POST') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'ليس لديك صلاحية');
    return mutate((state) => {
      const id = Number.parseInt(pathname.split('/')[3] ?? '', 10);
      const original = state.transactions.find((entry) => numberValue(entry.id) === id);
      if (!original) return failure(404, 'الحركة غير موجودة.');
      if (original.reversedById) return json({ error: 'تم عكس هذه الحركة مسبقًا.', code: 'ALREADY_REVERSED' }, 409);
      if (original.reversalOfId) return json({ error: 'لا يمكن عكس قيد عكسي.', code: 'CANNOT_REVERSE_REVERSAL' }, 409);
      if (text(original.type).startsWith('custody')) {
        return json({ error: 'حركات العهدة تُدار عبر دورة الإرجاع.', code: 'CUSTODY_USE_RETURN_FLOW' }, 409);
      }
      const body = readBody(init) ?? {};
      const reason = text(body.reason).trim();
      if (reason.length < 5) return failure(400, 'سبب القيد العكسي مطلوب (5 أحرف على الأقل).');
      const itemId = numberValue(original.itemId);
      const item = state.items.find((entry) => numberValue(entry.id) === itemId);
      if (!item) return json({ error: 'لا يمكن تحديد الرصيد المرجعي لهذه الحركة.', code: 'REVERSAL_NOT_SUPPORTED' }, 409);
      const details = (original.details ?? {}) as Record<string, unknown>;
      const previousStock = details.previousStock;
      const outgoing = ['out', 'damage', 'central_return', 'central-return'].includes(text(original.type));
      const quantity = numberValue(original.quantity);
      const target = previousStock !== undefined && previousStock !== null
        ? numberValue(previousStock)
        : outgoing
          ? numberValue(item.currentStock) + quantity
          : Math.max(numberValue(item.currentStock) - quantity, 0);
      const delta = target - numberValue(item.currentStock);
      const warehouseId = numberValue(original.warehouseId, offlineWarehouseId(state));
      item.currentStock = target;
      if (delta > 0) {
        const batch = offlineOpenBatch(state, itemId, delta, warehouseId, {
          batchNumber: null,
          expiryDate: null,
          supplier: null,
          deliveryNoteNumber: `REV-${text(original.documentNumber)}`,
          deliveryNoteDate: now().slice(0, 10),
        });
        recordOfflineChange(state, 'inventory_batch', Number(batch.id), 'create', { ...batch });
      } else if (delta < 0) {
        offlineConsumeBatches(state, itemId, Math.abs(delta), warehouseId);
      }
      const reversal = {
        id: nextId(state),
        type: 'adjust',
        documentNumber: `REV-${text(original.documentNumber)}`,
        transactionDate: now().slice(0, 10),
        itemId,
        quantity: Math.abs(delta),
        notes: `قيد عكسي للمستند ${text(original.documentNumber)}: ${reason}`,
        reason,
        createdBy: currentUser?.id ?? null,
        createdAt: now(),
        warehouseId,
        reversalOfId: id,
      };
      state.transactions.unshift(reversal);
      original.reversedById = numberValue(reversal.id);
      original.reversedAt = now();
      original.reversalReason = reason;
      recordOfflineChange(state, 'transaction', Number(reversal.id), 'create', {
        type: 'adjust',
        documentNumber: reversal.documentNumber,
        itemId,
        quantity: reversal.quantity,
      });
      addAudit(state, currentUser, 'reverse', 'transaction', id);
      return json({ ok: true, reversal });
    });
  }

  // -------- reports: reorder suggestions, KPI, ABC, transfer variance --------
  if (pathname === '/api/reports/reorder-suggestions' && method === 'GET') {
    return read((state) => {
      const items = state.items
        .filter((item) => item.isActive !== false)
        .map((item) => {
          const current = numberValue(item.currentStock);
          const reorderPoint = item.reorderPoint === null || item.reorderPoint === undefined
            ? numberValue(item.minStock)
            : numberValue(item.reorderPoint);
          const maxLevel = item.maxStock === null || item.maxStock === undefined ? reorderPoint * 2 : numberValue(item.maxStock);
          return {
            id: numberValue(item.id),
            code: text(item.code) || null,
            name: text(item.name),
            unit: text(item.unit),
            currentStock: current,
            minStock: numberValue(item.minStock),
            reorderPoint,
            maxLevel,
            safetyStock: item.safetyStock === null || item.safetyStock === undefined ? null : numberValue(item.safetyStock),
            binCode: text(item.binCode) || null,
            shortfall: Math.max(reorderPoint - current, 0),
            suggestedQuantity: Math.max(maxLevel - current, 0),
            urgent: current === 0,
          };
        })
        .filter((row) => row.currentStock <= row.reorderPoint)
        .sort((a, b) => a.currentStock - b.currentStock);
      return json({ count: items.length, urgent: items.filter((row) => row.urgent).length, items, generatedAt: now() });
    });
  }
  if (pathname === '/api/reports/kpi' && method === 'GET') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'ليس لديك صلاحية');
    return read((state) => {
      const since = Date.now() - 90 * 24 * 60 * 60 * 1000;
      const stale = Date.now() - 180 * 24 * 60 * 60 * 1000;
      const outbound = state.transactions.filter(
        (entry) => text(entry.type) === 'out' && new Date(text(entry.createdAt)).getTime() >= since,
      );
      const consumed = outbound.reduce((sum, entry) => sum + numberValue(entry.quantity), 0);
      const active = state.items.filter((item) => item.isActive !== false);
      const totalStock = active.reduce((sum, item) => sum + numberValue(item.currentStock), 0);
      const movedItems = new Set(
        state.transactions
          .filter((entry) => text(entry.type) === 'out' && new Date(text(entry.createdAt)).getTime() >= stale)
          .map((entry) => numberValue(entry.itemId)),
      );
      const countedLines = state.countLines.filter((line) => line.countedQuantity !== null && line.countedQuantity !== undefined);
      const varianceLines = countedLines.filter((line) => numberValue(line.variance) !== 0);
      return json({
        window: { consumptionDays: 90, deadStockDays: 180 },
        turnover: totalStock > 0 ? Math.round((consumed / totalStock) * 100) / 100 : null,
        daysOfCover: consumed > 0 ? Math.round((totalStock / (consumed / 90)) * 10) / 10 : null,
        consumptionQuantity: consumed,
        averageStock: totalStock,
        items: active.length,
        movedItems: movedItems.size,
        deadStockItems: Math.max(active.length - movedItems.size, 0),
        deadStockRatio: active.length > 0 ? Math.round(((active.length - movedItems.size) / active.length) * 1000) / 10 : null,
        stockouts: active.filter((item) => numberValue(item.currentStock) === 0 && numberValue(item.minStock) > 0).length,
        belowMin: active.filter((item) => numberValue(item.currentStock) > 0 && numberValue(item.currentStock) <= numberValue(item.minStock)).length,
        countAccuracy: countedLines.length > 0 ? Math.round(((countedLines.length - varianceLines.length) / countedLines.length) * 1000) / 10 : null,
        countSessions: state.countSessions.length,
        generatedAt: now(),
      });
    });
  }
  if (pathname === '/api/reports/abc' && method === 'GET') {
    if (!roleAllowed(currentUser, ['admin'])) return failure(403, 'ليس لديك صلاحية');
    return read((state) => {
      const since = Date.now() - 90 * 24 * 60 * 60 * 1000;
      const totals = new Map<number, number>();
      for (const entry of state.transactions) {
        if (text(entry.type) !== 'out' || new Date(text(entry.createdAt)).getTime() < since) continue;
        const key = numberValue(entry.itemId);
        totals.set(key, (totals.get(key) ?? 0) + numberValue(entry.quantity));
      }
      const rows = [...totals.entries()]
        .map(([itemId, consumed]) => {
          const item = state.items.find((candidate) => numberValue(candidate.id) === itemId);
          return {
            itemId,
            name: item ? text(item.name) : null,
            code: item ? text(item.code) || null : null,
            unit: item ? text(item.unit) : null,
            currentStock: item ? numberValue(item.currentStock) : 0,
            consumed,
          };
        })
        .filter((row) => row.consumed > 0 && row.itemId > 0)
        .sort((a, b) => b.consumed - a.consumed);
      const total = rows.reduce((sum, row) => sum + row.consumed, 0);
      let running = 0;
      const items = rows.map((row) => {
        running += row.consumed;
        const share = total > 0 ? (running / total) * 100 : 0;
        return {
          ...row,
          share: Math.round((row.consumed / (total || 1)) * 1000) / 10,
          cumulativeShare: Math.round(share * 10) / 10,
          class: share <= 80 ? 'A' : share <= 95 ? 'B' : 'C',
        };
      });
      return json({
        totalQuantity: total,
        counts: {
          A: items.filter((row) => row.class === 'A').length,
          B: items.filter((row) => row.class === 'B').length,
          C: items.filter((row) => row.class === 'C').length,
        },
        items,
        generatedAt: now(),
      });
    });
  }
  if (pathname === '/api/reports/transfer-variance' && method === 'GET') {
    return read((state) => {
      const rows = state.transferLines
        .filter((line) => line.variance !== null && line.variance !== undefined && numberValue(line.variance) !== 0)
        .map((line) => {
          const transfer = state.transfers.find((entry) => numberValue(entry.id) === numberValue(line.transferId));
          const item = state.items.find((entry) => numberValue(entry.id) === numberValue(line.itemId));
          return {
            transferId: numberValue(line.transferId),
            code: transfer ? text(transfer.code) : null,
            status: transfer ? text(transfer.status) : null,
            fromWarehouseId: transfer ? numberValue(transfer.fromWarehouseId) : null,
            toWarehouseId: transfer ? numberValue(transfer.toWarehouseId) : null,
            receivedAt: transfer ? transfer.receivedAt ?? null : null,
            lineId: numberValue(line.id),
            itemId: numberValue(line.itemId),
            itemName: item ? text(item.name) : null,
            itemCode: item ? text(item.code) || null : null,
            unit: text(line.unit) || null,
            shipped: numberValue(line.quantity),
            received: line.receivedQuantity === null || line.receivedQuantity === undefined ? null : numberValue(line.receivedQuantity),
            variance: numberValue(line.variance),
            varianceReason: text(line.varianceReason) || null,
          };
        })
        .map((row) => ({
          ...row,
          variancePercent: row.shipped > 0 ? Math.round((row.variance / row.shipped) * 1000) / 10 : null,
        }));
      return json({
        count: rows.length,
        totalVariance: rows.reduce((sum, row) => sum + row.variance, 0),
        items: rows,
        generatedAt: now(),
      });
    });
  }

  return failure(404, 'Ø§Ù„Ù…Ø³Ø§Ø± ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯ ÙÙŠ Ø§Ù„ÙˆØ¶Ø¹ Ø§Ù„Ù…Ø­Ù„ÙŠ');
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
        'Ø§Ù†ØªÙ‡Øª Ù…Ù‡Ù„Ø© ØªÙ†ÙÙŠØ° Ø§Ù„Ø¹Ù…Ù„ÙŠØ© Ø§Ù„Ù…Ø­Ù„ÙŠØ©',
        OFFLINE_REQUEST_TIMEOUT_MS,
      );
      return response;
    } catch (error) {
      console.error('Offline API error:', error);
      return failure(500, error instanceof Error ? error.message : 'ØªØ¹Ø°Ø± ØªÙ†ÙÙŠØ° Ø§Ù„Ø¹Ù…Ù„ÙŠØ© Ø§Ù„Ù…Ø­Ù„ÙŠØ©');
    }
  };
}


