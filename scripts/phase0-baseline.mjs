import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { read, utils } from "xlsx";

if (process.env.DATABASE_URL) {
  throw new Error("phase0-baseline refuses to run when DATABASE_URL is set");
}

const root = process.env.INIT_CWD || join(process.cwd(), "..");
const port = Number(process.env.PHASE0_PORT || 8091);
const password = process.env.PHASE0_ADMIN_PASSWORD || "Phase0!Synthetic-2026";
const packagePassword = "Phase0!Package-2026";
const dataDir = await mkdtemp(join(tmpdir(), "dme-phase0-"));
const apiEntry = join(root, "artifacts", "api-server", "dist", "index.mjs");
const seedEntry = join(root, "artifacts", "api-server", "dist", "seed.mjs");
const schemaPath = join(root, "lib", "db", "desktop-schema.sql");

if (!existsSync(apiEntry)) {
  throw new Error("Build the API first with pnpm run build");
}
if (!existsSync(seedEntry)) {
  const seedBuild = spawnSync(process.execPath, ["build-seed.mjs"], {
    cwd: join(root, "artifacts", "api-server"),
    encoding: "utf8",
  });
  if (seedBuild.status !== 0 || !existsSync(seedEntry)) {
    throw new Error(`Could not build the seed entry: ${seedBuild.stderr || seedBuild.stdout}`);
  }
}

let server;
let cookie = "";

async function waitForHealth() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/healthz`);
      if (response.ok) return;
    } catch {
      // The child is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("phase0 API did not become healthy");
}

async function stopServer() {
  if (!server) return;
  server.kill("SIGTERM");
  await new Promise((resolve) => server.once("exit", resolve));
  server = undefined;
}

async function startServer() {
  server = spawn(process.execPath, [apiEntry], {
    cwd: root,
    env: {
      ...process.env,
      DAMASCUS_DESKTOP: "1",
      DAMASCUS_SCHEMA_PATH: schemaPath,
      DAMASCUS_DATA_DIR: dataDir,
      NODE_ENV: "development",
      PORT: String(port),
      SEED_ADMIN_PASSWORD: password,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  server.stdout.on("data", (chunk) => { output += String(chunk); });
  server.stderr.on("data", (chunk) => { output += String(chunk); });
  server.on("exit", (code) => {
    if (code && !server?.__stopping) console.error(output);
  });
  await waitForHealth();
}

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

function assert(condition, message, details = undefined) {
  if (!condition) {
    const suffix = details === undefined ? "" : `: ${JSON.stringify(details)}`;
    throw new Error(`${message}${suffix}`);
  }
}

try {
  await startServer();
  await stopServer();
  const seed = spawnSync(process.execPath, ["--enable-source-maps", seedEntry], {
    cwd: join(root, "artifacts", "api-server"),
    env: {
      ...process.env,
      DAMASCUS_DESKTOP: "1",
      DAMASCUS_SCHEMA_PATH: schemaPath,
      DAMASCUS_DATA_DIR: dataDir,
      SEED_ADMIN_PASSWORD: password,
    },
    encoding: "utf8",
  });
  assert(seed.status === 0, "seed failed", seed.stderr || seed.stdout);
  await startServer();

  const health = await api("/api/healthz");
  assert(health.status === 200, "health check failed", health);

  const login = await api("/api/auth/login", {
    method: "POST",
    body: { username: "admin", password },
  });
  assert(login.status === 200, "admin login failed", login);

  const created = await api("/api/items", {
    method: "POST",
    body: {
      code: "PH0-API-001",
      name: "مادة خط أساس اصطناعية",
      itemType: "item",
      unit: "علبة",
      currentStock: 0,
      minStock: 1,
    },
  });
  assert(created.status === 201 && created.payload?.id, "material creation failed", created);
  const itemId = created.payload.id;

  const inbound = await api("/api/transactions/in", {
    method: "POST",
    body: {
      itemType: "item",
      itemId,
      quantity: 7,
      deliveryNoteNumber: "PH0-IN-001",
      deliveryNoteDate: "2026-09-09",
      supplySource: "central_warehouses",
      batchNumber: "PH0-B-001",
      expiryDate: "2027-01-31",
      notes: "حركة اختبارية اصطناعية",
    },
  });
  assert(inbound.status === 201 && inbound.payload?.id, "inbound batch failed", inbound);

  const history = await api(`/api/items/history?itemId=${itemId}`);
  assert(history.status === 200 && history.payload?.batches?.length === 1, "batch details missing", history);
  assert(history.payload.batches[0].batchNumber === "PH0-B-001", "batch number not visible", history.payload);

  const fefo = await api(`/api/items/fefo-preview?itemId=${itemId}&quantity=3`);
  assert(fefo.status === 200 && fefo.payload?.canFulfill === true, "FEFO preview failed", fefo);
  assert(fefo.payload.allocations?.[0]?.batchNumber === "PH0-B-001", "FEFO did not use the batch", fefo.payload);

  const fixturePath = join(root, "fixtures", "inventory-phase0", "03-new-item.xlsx");
  const fixtureBook = read(await readFile(fixturePath), { type: "buffer", cellDates: true });
  const rows = utils.sheet_to_json(fixtureBook.Sheets[fixtureBook.SheetNames[0]], { defval: null });
  const imported = await api("/api/items/bulk-import", { method: "POST", body: rows });
  assert(imported.status === 200 && imported.payload?.created === 1 && imported.payload?.errors?.length === 0, "import baseline failed", imported);

  const exported = await api("/api/backups/export", {
    method: "POST",
    body: { password: packagePassword },
  });
  assert(exported.status === 200 && exported.payload instanceof Uint8Array && exported.payload.length > 100, "export failed", { status: exported.status });
  let binary = "";
  for (let i = 0; i < exported.payload.length; i += 0x8000) {
    binary += String.fromCharCode(...exported.payload.subarray(i, i + 0x8000));
  }
  const packageBase64 = Buffer.from(binary, "binary").toString("base64");
  const inspected = await api("/api/backups/inspect", {
    method: "POST",
    body: { packageBase64, password: packagePassword },
  });
  assert(
    inspected.status === 200 && inspected.payload?.manifest?.packageType === "full-backup",
    "export inspection failed",
    inspected,
  );
  const dryRun = await api("/api/backups/dry-run", {
    method: "POST",
    body: { packageBase64, password: packagePassword, mode: "merge" },
  });
  assert(dryRun.status === 200 && dryRun.payload?.token, "restore dry-run failed", dryRun);
  const restored = await api("/api/backups/restore", {
    method: "POST",
    body: {
      packageBase64,
      password: packagePassword,
      mode: "merge",
      confirm: true,
      previewToken: dryRun.payload.token,
    },
  });
  assert(restored.status === 200 && restored.payload?.restorePointId, "restore failed", restored);
  const restoredHistory = await api(`/api/items/history?itemId=${itemId}`);
  assert(
    restoredHistory.status === 200 && restoredHistory.payload?.batches?.length === 1,
    "restore changed the batch count",
    restoredHistory,
  );
  const rollback = await api(`/api/backups/${restored.payload.restorePointId}/rollback`, {
    method: "POST",
    body: { confirm: true },
  });
  assert(rollback.status === 200, "rollback failed", rollback);
  const rolledBackHistory = await api(`/api/items/history?itemId=${itemId}`);
  assert(
    rolledBackHistory.status === 200 && rolledBackHistory.payload?.batches?.length === 1,
    "rollback changed the batch count",
    rolledBackHistory,
  );

  console.log(JSON.stringify({
    status: "passed",
    database: "isolated temporary PGlite",
    health: health.status,
    createdItemId: itemId,
    inboundTransactionId: inbound.payload.id,
    batchCount: history.payload.batches.length,
    fefo: fefo.payload.allocations,
    import: imported.payload,
    backup: {
      bytes: exported.payload.length,
      packageType: inspected.payload.manifest.packageType,
      recordCount: inspected.payload.recordCount,
      changeCount: inspected.payload.changeCount,
      restore: "passed",
      rollback: "passed",
    },
  }, null, 2));
} finally {
  if (server) {
    server.__stopping = true;
    await stopServer().catch(() => {});
  }
  await rm(dataDir, { recursive: true, force: true });
}