import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

if (process.env.DATABASE_URL) {
  throw new Error("backup acceptance refuses to run when DATABASE_URL is set");
}

const root = process.env.INIT_CWD || process.cwd();
const port = Number(process.env.BACKUP_ACCEPTANCE_PORT || 8391);
const adminPassword = "Phase7!Synthetic-2026";
const packagePassword = "Phase7!Package-2026";
const sessionSecret = "Phase7!Session-Only-2026";
const dataDir = await mkdtemp(join(tmpdir(), "dme-backup-acceptance-"));
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
    throw new Error(`Could not build seed entry: ${seedBuild.stderr || seedBuild.stdout}`);
  }
}

let server;
let cookie = "";

async function waitForHealth() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/healthz`);
      if (response.ok) return;
    } catch {
      // The child is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("backup acceptance API did not become healthy");
}

async function stopServer() {
  if (!server) return;
  if (server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  }
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
      SEED_ADMIN_PASSWORD: adminPassword,
      SESSION_SECRET: sessionSecret,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  server.stdout.on("data", (chunk) => { output += String(chunk); });
  server.stderr.on("data", (chunk) => { output += String(chunk); });
  server.on("exit", (code) => {
    if (code && server?.__stopping) return;
    if (code) console.error(output.slice(-2000));
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

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details === undefined ? "" : `: ${JSON.stringify(details)}`;
    throw new Error(`${message}${suffix}`);
  }
}

function packageBase64(payload) {
  return Buffer.from(payload).toString("base64");
}

function tamper(base64) {
  const bytes = Buffer.from(base64, "base64");
  const position = Math.max(0, Math.floor(bytes.length / 2));
  bytes[position] ^= 1;
  return bytes.toString("base64");
}

async function seedSchema() {
  await startServer();
  server.__stopping = true;
  await stopServer();
  const seed = spawnSync(process.execPath, ["--enable-source-maps", seedEntry], {
    cwd: join(root, "artifacts", "api-server"),
    env: {
      ...process.env,
      DAMASCUS_DESKTOP: "1",
      DAMASCUS_SCHEMA_PATH: schemaPath,
      DAMASCUS_DATA_DIR: dataDir,
      SEED_ADMIN_PASSWORD: adminPassword,
      SESSION_SECRET: sessionSecret,
    },
    encoding: "utf8",
  });
  assert(seed.status === 0, "seed failed", seed.stderr || seed.stdout);
  await startServer();
}

try {
  await seedSchema();
  assert((await api("/api/auth/login", {
    method: "POST",
    body: { username: "admin", password: adminPassword },
  })).status === 200, "admin login failed");

  const item = await api("/api/items", {
    method: "POST",
    body: {
      code: "PH7-BACKUP-001",
      name: "مادة اختبار النسخ والاستعادة",
      itemType: "item",
      unit: "علبة",
      currentStock: 0,
      minStock: 1,
    },
  });
  assert(item.status === 201 && item.payload?.id, "synthetic item creation failed", item);
  const itemId = item.payload.id;

  const inbound = await api("/api/transactions/in", {
    method: "POST",
    body: {
      itemType: "item",
      itemId,
      quantity: 11,
      deliveryNoteNumber: "PH7-BACKUP-IN-001",
      deliveryNoteDate: "2026-09-17",
      supplySource: "central_warehouses",
      batchNumber: "PH7-B-001",
      expiryDate: "2027-09-17",
      notes: "بيانات اصطناعية لاختبار المرحلة السابعة",
    },
  });
  assert(inbound.status === 201, "synthetic inbound failed", inbound);

  const changeCommittedAt = performance.now();
  const exportStartedAt = performance.now();
  const exported = await api("/api/backups/export", {
    method: "POST",
    body: { password: packagePassword },
  });
  const exportElapsedMs = performance.now() - exportStartedAt;
  assert(exported.status === 200 && exported.payload instanceof Uint8Array, "full backup export failed");
  const packageB64 = packageBase64(exported.payload);
  assert(exported.payload.length > 100, "backup package is unexpectedly small");

  const inspected = await api("/api/backups/inspect", {
    method: "POST",
    body: { packageBase64: packageB64, password: packagePassword },
  });
  assert(inspected.status === 200 && inspected.payload?.manifest?.packageType === "full-backup", "inspect failed", inspected);

  const wrongPassword = await api("/api/backups/inspect", {
    method: "POST",
    body: { packageBase64: packageB64, password: "wrong-password" },
  });
  assert(wrongPassword.status === 400, "wrong password was accepted", wrongPassword);

  const tampered = await api("/api/backups/inspect", {
    method: "POST",
    body: { packageBase64: tamper(packageB64), password: packagePassword },
  });
  assert(tampered.status === 400, "tampered package was accepted", tampered);

  const afterBackup = await api("/api/items", {
    method: "POST",
    body: {
      code: "PH7-AFTER-BACKUP",
      name: "يبقى بعد استعادة merge",
      itemType: "item",
      unit: "علبة",
      currentStock: 4,
      minStock: 1,
    },
  });
  assert(afterBackup.status === 201, "post-backup source protection fixture failed", afterBackup);

  const preview = await api("/api/backups/dry-run", {
    method: "POST",
    body: { packageBase64: packageB64, password: packagePassword, mode: "merge" },
  });
  assert(preview.status === 200 && preview.payload?.token, "restore dry-run failed", preview);

  const restoreStartedAt = performance.now();
  const restored = await api("/api/backups/restore", {
    method: "POST",
    body: {
      packageBase64: packageB64,
      password: packagePassword,
      mode: "merge",
      confirm: true,
      previewToken: preview.payload.token,
    },
  });
  const restoreElapsedMs = performance.now() - restoreStartedAt;
  assert(restored.status === 200 && restored.payload?.restorePointId, "restore failed", restored);

  const report = await api(`/api/backups/${restored.payload.restorePointId}/report`);
  assert(
    report.status === 200 &&
      report.payload?.status === "available" &&
      typeof report.payload?.packageHash === "string" &&
      report.payload?.summary?.packageHash === report.payload.packageHash,
    "restore report missing",
    report,
  );

  const itemsAfterRestore = await api("/api/items");
  assert(itemsAfterRestore.status === 200, "items could not be read after restore");
  assert(
    itemsAfterRestore.payload?.items?.some((entry) => entry.code === "PH7-AFTER-BACKUP"),
    "merge overwrote newer source data",
  );

  const history = await api(`/api/items/history?itemId=${itemId}`);
  assert(history.status === 200 && history.payload?.batches?.length === 1, "restored history is inconsistent", history);

  const audit = await api("/api/audit?action=backup_package_restore");
  assert(audit.status === 200 && audit.payload?.data?.some((entry) => entry.action === "backup_package_restore"), "restore audit entry missing", audit);

  const rollbackStartedAt = performance.now();
  const rollback = await api(`/api/backups/${restored.payload.restorePointId}/rollback`, {
    method: "POST",
    body: { confirm: true },
  });
  const rollbackElapsedMs = performance.now() - rollbackStartedAt;
  assert(rollback.status === 200 && rollback.payload?.restorePointId, "rollback failed", rollback);

  const cataloged = await api("/api/backups", {
    method: "POST",
    body: { password: packagePassword, packageType: "full-backup", retentionClass: "daily" },
  });
  assert(cataloged.status === 201 && cataloged.payload?.id, "catalog backup creation failed", cataloged);
  const catalogVerify = await api(`/api/backups/${cataloged.payload.id}/verify`, {
    method: "POST",
    body: { password: packagePassword },
  });
  assert(catalogVerify.status === 200 && catalogVerify.payload?.verified === true, "catalog verification failed", catalogVerify);

  const sourceChangeToBackupMinutes = Number(((performance.now() - changeCommittedAt) / 60000).toFixed(4));
  console.log(JSON.stringify({
    status: "passed",
    environment: "isolated temporary PGlite",
    data: "synthetic only",
    checks: {
      fullExport: "passed",
      inspect: "passed",
      wrongPasswordRejected: "passed",
      tamperRejected: "passed",
      mergePreservedNewerSourceData: "passed",
      restore: "passed",
      restoreReport: "passed",
      restoreAudit: "passed",
      rollback: "passed",
      catalogVerify: "passed",
    },
    measurements: {
      exportElapsedMs: Number(exportElapsedMs.toFixed(2)),
      restoreElapsedMs: Number(restoreElapsedMs.toFixed(2)),
      rollbackElapsedMs: Number(rollbackElapsedMs.toFixed(2)),
      syntheticRpoObservationMinutes: sourceChangeToBackupMinutes,
    },
    package: {
      bytes: exported.payload.length,
      packageType: inspected.payload.manifest.packageType,
      recordCount: inspected.payload.recordCount,
      changeCount: inspected.payload.changeCount,
      packageHash: inspected.payload.manifest.packageHash,
    },
    restorePointId: restored.payload.restorePointId,
  }, null, 2));
} finally {
  if (server) {
    server.__stopping = true;
    await stopServer().catch(() => {});
  }
  await rm(dataDir, { recursive: true, force: true });
}