import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

if (process.env.DATABASE_URL) {
  throw new Error("feature-complete backup generation refuses to run with DATABASE_URL set");
}

const root = process.env.INIT_CWD || process.cwd();
const packagePassword = process.env.DAMASCUS_SYNC_PACKAGE_PASSWORD;
if (!packagePassword) {
  throw new Error("DAMASCUS_SYNC_PACKAGE_PASSWORD is required through the workspace secrets flow");
}

const adminPassword = "V504-Feature-Test-Admin-2026";
const sessionSecret = "V504-Feature-Test-Session-2026";
const schemaPath = join(root, "lib", "db", "desktop-schema.sql");
const apiEntry = join(root, "artifacts", "api-server", "dist", "index.mjs");
const seedEntry = join(root, "artifacts", "api-server", "dist", "seed.mjs");
const outputPath = join(
  root,
  "artifacts",
  "backup-tests",
  "damascus-v5.0.4-feature-complete.dme-sync",
);

if (!existsSync(apiEntry)) throw new Error("Build the API first");
if (!existsSync(seedEntry)) throw new Error("Build the API seed first");

let nextPort = Number(process.env.V504_PACKAGE_PORT || 8410);
const apps = [];

function assert(condition, message, details) {
  if (!condition) {
    throw new Error(`${message}${details === undefined ? "" : `: ${JSON.stringify(details)}`}`);
  }
}

async function waitForHealth(port) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/healthz`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) return;
    } catch {
      // The child is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`API did not become healthy on ${port}`);
}

function stopProcess(server) {
  return new Promise((resolve) => {
    if (!server || server.exitCode !== null) {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const hardKillTimer = setTimeout(() => {
      if (server.exitCode === null) server.kill("SIGKILL");
    }, 1000);
    const resolveTimer = setTimeout(finish, 6000);
    server.once("exit", () => {
      clearTimeout(hardKillTimer);
      clearTimeout(resolveTimer);
      finish();
    });
    server.kill("SIGTERM");
  });
}

async function startApp(label) {
  console.error(`[v504-package] starting ${label}`);
  const dataDir = await import("node:fs/promises").then(({ mkdtemp }) =>
    mkdtemp(join(tmpdir(), `dme-v504-${label}-`)),
  );
  const port = nextPort++;
  const env = {
    ...process.env,
    DAMASCUS_DESKTOP: "1",
    DAMASCUS_SCHEMA_PATH: schemaPath,
    DAMASCUS_DATA_DIR: dataDir,
    NODE_ENV: "development",
    PORT: String(port),
    SEED_ADMIN_PASSWORD: adminPassword,
    SESSION_SECRET: sessionSecret,
  };

  let server = spawn(process.execPath, [apiEntry], {
    cwd: root,
    env,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  server.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  await waitForHealth(port);
  console.error(`[v504-package] ${label} initialized`);
  await stopProcess(server);

  const seed = spawnSync(process.execPath, ["--enable-source-maps", seedEntry], {
    cwd: join(root, "artifacts", "api-server"),
    env,
    encoding: "utf8",
  });
  assert(seed.status === 0, `${label}: seed failed`, seed.stderr || seed.stdout);

  server = spawn(process.execPath, [apiEntry], {
    cwd: root,
    env,
    stdio: ["ignore", "ignore", "pipe"],
  });
  stderr = "";
  server.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  await waitForHealth(port);
  console.error(`[v504-package] ${label} ready`);

  let cookie = "";
  async function api(path, { method = "GET", body } = {}) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("json")
      ? await response.json()
      : new Uint8Array(await response.arrayBuffer());
    return { status: response.status, payload };
  }

  const login = await api("/api/auth/login", {
    method: "POST",
    body: { username: "admin", password: adminPassword },
  });
  assert(login.status === 200, `${label}: admin login failed`, login);

  const app = {
    label,
    dataDir,
    port,
    api,
    getStderr: () => stderr,
    async stop() {
      await stopProcess(server);
      await rm(dataDir, { recursive: true, force: true });
    },
  };
  apps.push(app);
  return app;
}

async function post(app, path, body, expected = 200) {
  const result = await app.api(path, { method: "POST", body });
  assert(result.status === expected, `${app.label}: POST ${path} failed`, result);
  return result.payload;
}

function rows(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload[key])) return payload[key];
  return [];
}

async function buildFeatureDataset(app) {
  const unitsBefore = await app.api("/api/units");
  assert(unitsBefore.status === 200, "could not list units");
  let unit = rows(unitsBefore.payload).find((entry) => entry.name === "V504-TEST-UNIT");
  if (!unit) {
    const created = await app.api("/api/units", {
      method: "POST",
      body: { name: "V504-TEST-UNIT", symbol: "v5", sortOrder: 504 },
    });
    assert(created.status === 201, "unit creation failed", created);
    unit = created.payload;
  }

  const warehouses = await app.api("/api/warehouses");
  assert(warehouses.status === 200, "could not list warehouses");
  let central = rows(warehouses.payload).find((entry) => entry.type === "central");
  if (!central) {
    central = await post(app, "/api/warehouses", {
      code: "V504-CENTRAL",
      name: "V504 Central Test Warehouse",
      type: "central",
      notes: "Synthetic feature-complete acceptance data",
    }, 201);
  }
  let branch = rows(warehouses.payload).find((entry) => entry.code === "V504-BRANCH");
  if (!branch) {
    branch = await post(app, "/api/warehouses", {
      code: "V504-BRANCH",
      name: "V504 Branch Test Warehouse",
      type: "branch",
      notes: "Synthetic transfer destination",
    }, 201);
  }
  await post(app, "/api/warehouses/current", { id: central.id });

  const bin = await post(app, "/api/bins", {
    code: "V504-A-01",
    name: "V504 Shelf A-01",
    warehouseId: central.id,
    zone: "A",
    notes: "Synthetic storage location",
  }, 201);

  const item = await post(app, "/api/items", {
    code: "V504-FEFO-001",
    name: "V504 FEFO and costing test item",
    itemType: "item",
    unit: unit.name,
    currentStock: 0,
    minStock: 2,
    reorderPoint: 3,
    maxStock: 30,
    safetyStock: 1,
    binCode: bin.code,
    location: "V504-A-01",
    supplier: "V504 Synthetic Supplier",
    notes: "Synthetic data for v5.0.4 full backup verification",
  }, 201);

  const secondItem = await post(app, "/api/items", {
    code: "V504-COUNT-002",
    name: "V504 Cycle count test item",
    itemType: "item",
    unit: unit.name,
    currentStock: 0,
    minStock: 100,
    binCode: bin.code,
    location: "V504-A-01",
    supplier: "V504 Synthetic Supplier",
  }, 201);

  const receipt = await post(app, "/api/receipts", {
    warehouseId: central.id,
    supplierName: "V504 Synthetic Supplier",
    deliveryNoteNumber: "V504-GRN-001",
    deliveryNoteDate: "2026-09-19",
    referenceNumber: "V504-PO-001",
    notes: "Partial acceptance, rejection, expiry and unit-cost coverage",
    lines: [
      {
        itemId: item.id,
        orderedQuantity: 10,
        receivedQuantity: 8,
        rejectedQuantity: 2,
        rejectionReason: "تالف عند الاستلام",
        batchNumber: "V504-BATCH-A",
        expiryDate: "2027-09-19",
        inspectionNotes: "Passed visual inspection for accepted quantity",
        unitCost: 12.5,
      },
      {
        itemId: secondItem.id,
        orderedQuantity: 5,
        receivedQuantity: 5,
        rejectedQuantity: 0,
        batchNumber: "V504-BATCH-B",
        expiryDate: "2028-01-19",
        unitCost: 7.25,
      },
    ],
  }, 201);
  const postedReceipt = await post(app, `/api/receipts/${receipt.id}/post`, {});
  assert(postedReceipt.receivedTotal === 13 && postedReceipt.rejectedTotal === 2, "receipt totals are wrong", postedReceipt);

  const fefo = await app.api(`/api/items/fefo-preview?itemId=${item.id}&quantity=2`);
  assert(fefo.status === 200 && fefo.payload.canFulfill === true, "FEFO preview failed", fefo);

  const transfer = await post(app, "/api/transfers", {
    fromWarehouseId: central.id,
    toWarehouseId: branch.id,
    items: [{ itemId: item.id, quantity: 2, unit: unit.name, batchNumber: "V504-BATCH-A", expiryDate: "2027-09-19" }],
    notes: "Synthetic transfer with receiving variance",
  }, 201);
  const issuedTransfer = await post(app, `/api/transfers/${transfer.id}/issue`, {});
  const transferLine = issuedTransfer.lines[0];
  const receivedTransfer = await post(app, `/api/transfers/${transfer.id}/receive`, {
    deliveryNoteNumber: "V504-TRF-RECEIVE-001",
    lines: [{ lineId: transferLine.id, receivedQuantity: 1, varianceReason: "قطعة مفقودة أثناء النقل" }],
  });
  assert(receivedTransfer.status === "received", "transfer was not received", receivedTransfer);

  const count = await post(app, "/api/counts", {
    warehouseId: central.id,
    scope: "full",
    blindCount: false,
    notes: "Synthetic count with approved variance",
  }, 201);
  const countEntries = count.lines.map((line) => ({
    lineId: line.id,
    countedQuantity: Number(line.systemQuantity) + (line.itemId === secondItem.id ? 1 : 0),
    varianceReason: line.itemId === secondItem.id ? "اختبار فرق الجرد" : null,
  }));
  await post(app, `/api/counts/${count.id}/entries`, { entries: countEntries });
  const approvedCount = await post(app, `/api/counts/${count.id}/approve`, {});
  assert(approvedCount.session.status === "approved", "count approval failed", approvedCount);

  const transactions = await app.api("/api/transactions?limit=200");
  assert(transactions.status === 200, "could not list transactions");
  const receiptTransaction = rows(transactions.payload, "transactions").find(
    (entry) =>
      String(entry.notes ?? "").includes("C-GRN-2026") &&
      entry.type === "in" &&
      entry.itemId === item.id,
  );
  assert(receiptTransaction?.id, "posted receipt transaction was not found", transactions);
  const reversal = await post(app, `/api/transactions/${receiptTransaction.id}/reverse`, {
    reason: "اختبار القيد العكسي للإصدار 5.0.4",
  });
  assert(reversal.ok === true, "transaction reversal failed", reversal);

  const importRows = {
    items: [{
      rowNumber: 1,
      code: "V504-IMPORT-003",
      name: "V504 bulk import rollback item",
      unit: "علبة",
      minStock: 1,
      location: "V504-A-01",
      notes: "Will be rolled back to preserve import journal coverage",
    }],
    openingBatches: [],
  };
  const importPreview = await app.api("/api/items/bulk-import/preview?mode=insert", {
    method: "POST",
    body: importRows,
  });
  assert(importPreview.status === 200, "bulk import preview failed", importPreview);
  const imported = await app.api("/api/items/bulk-import?mode=insert", {
    method: "POST",
    body: importRows,
  });
  assert(imported.status === 200 && imported.payload.batchId, "bulk import failed", imported);
  const rolledBack = await post(app, `/api/import-batches/${imported.payload.batchId}/rollback`, {});
  assert(rolledBack.restored || rolledBack.status === "rolled_back" || rolledBack.ok !== false, "import rollback failed", rolledBack);

  const refreshedAlerts = await app.api("/api/alerts/refresh", { method: "POST", body: {} });
  assert([200, 202].includes(refreshedAlerts.status), "alert refresh failed", refreshedAlerts);
  const alerts = await app.api("/api/alerts");
  assert(alerts.status === 200, "alert listing failed", alerts);

  return {
    unitId: unit.id,
    centralWarehouseId: central.id,
    branchWarehouseId: branch.id,
    binId: bin.id,
    itemId: item.id,
    secondItemId: secondItem.id,
    receiptId: receipt.id,
    transferId: transfer.id,
    countId: count.id,
    importBatchId: imported.payload.batchId,
    alertCount: rows(alerts.payload, "alerts").length,
  };
}

async function run() {
  const source = await startApp("source");
  let packageBuffer;
  let sourceFixture;
  try {
    sourceFixture = await buildFeatureDataset(source);
    const exported = await source.api("/api/backups/export", {
      method: "POST",
      body: { password: packagePassword },
    });
    assert(
      exported.status === 200 && exported.payload instanceof Uint8Array,
      "backup export failed",
      { status: exported.status, payloadType: typeof exported.payload, payload: exported.payload instanceof Uint8Array ? { bytes: exported.payload.length } : exported.payload },
    );
    packageBuffer = Buffer.from(exported.payload);
    assert(packageBuffer.length > 500, "generated package is unexpectedly small");
  } finally {
    await source.stop();
  }

  await mkdir(join(root, "artifacts", "backup-tests"), { recursive: true });
  await writeFile(outputPath, packageBuffer);

  const target = await startApp("target");
  let verification;
  try {
    const packageBase64 = packageBuffer.toString("base64");
    const inspect = await target.api("/api/backups/inspect", {
      method: "POST",
      body: { packageBase64, password: packagePassword },
    });
    assert(inspect.status === 200, "generated package inspect failed", inspect);
    const expectedTypes = [
      "units", "warehouses", "bins", "import_batches", "receipts", "receipt_lines",
      "transfers", "transfer_lines", "count_sessions", "count_lines", "alerts",
    ];
    const actualTypes = new Set(inspect.payload.entityTypes || []);
    const missingTypes = expectedTypes.filter((type) => !actualTypes.has(type));
    assert(missingTypes.length === 0, "generated package misses feature entity types", { missingTypes, actualTypes: [...actualTypes] });

    const preview = await target.api("/api/backups/dry-run", {
      method: "POST",
      body: { packageBase64, password: packagePassword, mode: "full" },
    });
    assert(preview.status === 200 && preview.payload.token, "generated package dry-run failed", preview);
    assert(preview.payload.report.counts.rejected === 0, "generated package has rejected records", preview.payload.report);

    const restored = await target.api("/api/backups/restore", {
      method: "POST",
      body: {
        packageBase64,
        password: packagePassword,
        mode: "full",
        confirm: true,
        previewToken: preview.payload.token,
      },
    });
    assert(restored.status === 200 && restored.payload.restorePointId, "generated package restore failed", restored);

    const [warehouses, units, bins, receipts, transfers, counts, importBatches, alerts] = await Promise.all([
      target.api("/api/warehouses"),
      target.api("/api/units"),
      target.api("/api/bins"),
      target.api("/api/receipts"),
      target.api("/api/transfers"),
      target.api("/api/counts"),
      target.api("/api/import-batches"),
      target.api("/api/alerts"),
    ]);
    assert(warehouses.status === 200 && rows(warehouses.payload).some((row) => row.code === "V504-BRANCH"), "warehouse data did not restore");
    assert(units.status === 200 && rows(units.payload).some((row) => row.name === "V504-TEST-UNIT"), "unit data did not restore");
    assert(bins.status === 200 && rows(bins.payload).some((row) => row.code === "V504-A-01"), "bin data did not restore");
    assert(receipts.status === 200 && rows(receipts.payload).some((row) => row.deliveryNoteNumber === "V504-GRN-001"), "receipt data did not restore");
    assert(transfers.status === 200 && rows(transfers.payload).some((row) => row.status === "received"), "transfer data did not restore");
    assert(counts.status === 200 && rows(counts.payload).some((row) => row.status === "approved"), "count data did not restore");
    assert(importBatches.status === 200 && rows(importBatches.payload).some((row) => row.status === "rolled_back"), "import journal did not restore");
    assert(alerts.status === 200, "alerts did not restore");

    verification = {
      inspect: inspect.payload,
      dryRunCounts: preview.payload.report.counts,
      restoreCounts: restored.payload.counts,
      restoredFeatureCounts: {
        warehouses: rows(warehouses.payload).length,
        units: rows(units.payload).length,
        bins: rows(bins.payload).length,
        receipts: rows(receipts.payload).length,
        transfers: rows(transfers.payload).length,
        counts: rows(counts.payload).length,
        importBatches: rows(importBatches.payload).length,
        alerts: rows(alerts.payload).length,
      },
    };
  } finally {
    await target.stop();
  }

  console.log(JSON.stringify({
    status: "passed",
    outputPath,
    fixture: sourceFixture,
    package: {
      bytes: packageBuffer.length,
      packageHash: verification.inspect.packageHash,
      recordCount: verification.inspect.recordCount,
      changeCount: verification.inspect.changeCount,
      entityTypes: verification.inspect.entityTypes,
    },
    verification: {
      dryRunCounts: verification.dryRunCounts,
      restoreCounts: verification.restoreCounts,
      restoredFeatureCounts: verification.restoredFeatureCounts,
    },
  }, null, 2));
}

try {
  await run();
} finally {
  for (const app of apps) {
    await app.stop().catch(() => {});
  }
}