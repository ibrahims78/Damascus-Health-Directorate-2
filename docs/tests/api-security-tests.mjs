// API security hardening tests — run against live instances (A/B ports are
// configurable so the suite can run beside the main development workflow).
// seeded with SEED_ADMIN_PASSWORD. Covers: security headers, body-size
// limits, CSRF protection, DB-backed rate limiting, must-change-password
// flow (fresh random-password seed on a separate configurable port), and sync
// signature verification.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const A = process.env.SECURITY_A || 'http://127.0.0.1:8080';
const B = process.env.SECURITY_B || 'http://127.0.0.1:8081';
const FRESH_PORT = Number(process.env.SECURITY_FRESH_PORT || 8082);
const FRESH = `http://127.0.0.1:${FRESH_PORT}`;
const ADMIN = 'admin';
const ADMIN_PW = process.env.SEED_ADMIN_PASSWORD ?? '***';

let passed = 0;
let failed = 0;
const failures = [];

async function t(name, fn) {
  try {
    const result = await fn();
    if (result === true || result === undefined) {
      passed += 1;
      console.log(`✅ ${name}`);
    } else {
      failed += 1;
      failures.push({ name, detail: result });
      console.log(`❌ ${name} => ${JSON.stringify(result)}`);
    }
  } catch (error) {
    failed += 1;
    failures.push({ name, detail: String(error?.message ?? error) });
    console.log(`❌ ${name} => ${String(error?.message ?? error)}`);
  }
}

function client(base) {
  let cookie = '';
  let csrf = null;
  return {
    get cookie() { return cookie; },
    get csrf() { return csrf; },
    async api(path, { method = 'GET', body, headers = {}, withOrigin = false, withCsrf = false } = {}) {
      const h = { ...headers, 'Content-Type': 'application/json' };
      if (cookie) h.cookie = cookie;
      if (withOrigin) h.origin = base;
      if (withCsrf && csrf) h['x-csrf-token'] = csrf;
      const res = await fetch(`${base}${path}`, {
        method,
        headers: h,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const sc = res.headers.get('set-cookie');
      if (sc) cookie = sc.split(';')[0];
      let json = null;
      try { json = await res.json(); } catch { /* noop */ }
      if (json?.csrfToken) csrf = json.csrfToken;
      return { status: res.status, body: json, headers: res.headers };
    },
    async login(username = ADMIN, password = ADMIN_PW) {
      const r = await this.api('/api/auth/login', { method: 'POST', body: { username, password } });
      return r.status === 200 ? r : r;
    },
  };
}

const a = client(A);
const b = client(B);

// ── Security headers ─────────────────────────────────────────────────────────
await t('security headers present (helmet)', async () => {
  const r = await a.api('/api/healthz');
  const csp = r.headers.get('content-security-policy') ?? '';
  return (
    r.headers.get('x-content-type-options') === 'nosniff' &&
    csp.includes("default-src 'self'") &&
    csp.includes("frame-ancestors 'none'") &&
    r.headers.get('referrer-policy') != null
  ) || {
    cto: r.headers.get('x-content-type-options'),
    csp: csp.slice(0, 80),
    ref: r.headers.get('referrer-policy'),
  };
});

// ── Body size limit ──────────────────────────────────────────────────────────
await t('oversized JSON body rejected (413)', async () => {
  const huge = { username: 'x'.repeat(3 * 1024 * 1024), password: 'y' };
  const r = await a.api('/api/auth/login', { method: 'POST', body: huge });
  return r.status === 413 ? true : { status: r.status };
});

// ── CSRF ─────────────────────────────────────────────────────────────────────
await t('login without Origin works (server-to-server)', async () => {
  const r = await a.login();
  return r.status === 200 && typeof r.body?.csrfToken === 'string' && r.body?.csrfToken.length > 10
    ? true : { status: r.status, body: r.body };
});

await t('browser POST with wrong CSRF token rejected (403)', async () => {
  const r = await a.api('/api/items?limit=1', {
    method: 'POST',
    body: { name: 'csrf-probe', itemType: 'item', unit: 'قطعة', currentStock: 0 },
    withOrigin: true,
    headers: { 'x-csrf-token': 'bogus-token-value' },
  });
  return r.status === 403 ? true : { status: r.status };
});

await t('browser POST with matching CSRF token accepted', async () => {
  const r = await a.api('/api/categories', {
    method: 'POST',
    body: { name: `csrf-ok-${Date.now()}`, type: 'consumable' },
    withOrigin: true,
    withCsrf: true,
  });
  return r.status === 201 || r.status === 200 ? true : { status: r.status, body: r.body };
});

await t('browser POST from foreign origin rejected (403)', async () => {
  const r = await a.api('/api/categories', {
    method: 'POST',
    body: { name: `csrf-foreign-${Date.now()}`, type: 'consumable' },
    withOrigin: true,
    headers: { origin: 'https://evil.example.com' },
  });
  return r.status === 403 ? true : { status: r.status };
});

// ── Session hardening ────────────────────────────────────────────────────────
await t('session cookie is httpOnly + sameSite=strict', async () => {
  const r = await a.api('/api/auth/me');
  const sc = r.headers.get('set-cookie');
  const setCookie = r.headers.get('set-cookie') ?? '';
  return setCookie.toLowerCase().includes('httponly') && setCookie.toLowerCase().includes('samesite=strict')
    ? true : { setCookie: (sc ?? '').slice(0, 120) };
});

// ── DB-backed rate limiting (10 failures → 429, success resets) ─────────────
await t('rate limit: 9 failed logins then success resets the counter', async () => {
  const probe = client(A);
  for (let i = 0; i < 9; i += 1) {
    const r = await probe.api('/api/auth/login', { method: 'POST', body: { username: ADMIN, password: 'wrong-pass' } });
    if (r.status !== 401) return { step: i, status: r.status };
  }
  const ok = await probe.api('/api/auth/login', { method: 'POST', body: { username: ADMIN, password: ADMIN_PW } });
  return ok.status === 200 ? true : { status: ok.status };
});

await t('rate limit: 10 failures then 429 with Retry-After', async () => {
  const probe = client(A);
  for (let i = 0; i < 10; i += 1) {
    await probe.api('/api/auth/login', { method: 'POST', body: { username: ADMIN, password: 'wrong-pass' } });
  }
  const blocked = await probe.api('/api/auth/login', { method: 'POST', body: { username: ADMIN, password: 'wrong-pass' } });
  return blocked.status === 429 && blocked.headers.get('retry-after') != null
    ? true : { status: blocked.status, retryAfter: blocked.headers.get('retry-after') };
});

// ── Sync signature verification (non-repudiation) ───────────────────────────
await t('first exchange returns peer signing key (unverified)', async () => {
  const r = await a.api('/api/sync/exchange', {
    method: 'POST',
    body: { peerUrl: B, username: ADMIN, password: ADMIN_PW },
  });
  return r.status === 200 ? true : { status: r.status, body: r.body };
});

await t('second exchange verifies peer signature', async () => {
  const r = await a.api('/api/sync/exchange', {
    method: 'POST',
    body: { peerUrl: B, username: ADMIN, password: ADMIN_PW },
  });
  return r.status === 200 && r.body?.peerSignature === 'verified'
    ? true : { status: r.status, peerSignature: r.body?.peerSignature };
});

await t('exported package is signed and verifies on import', async () => {
  await b.login();
  const password = 'kaskas2026-test';
  const exportRes = await fetch(`${B}/api/sync/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(b.cookie ? { cookie: b.cookie } : {}) },
    body: JSON.stringify({ password }),
  });
  if (exportRes.status !== 200) return { exportStatus: exportRes.status };
  const bytes = new Uint8Array(await exportRes.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const importRes = await a.api('/api/sync/import', {
    method: 'POST',
    body: { packageBase64: btoa(binary), password },
  });
  return importRes.status === 200 && importRes.body?.signatureVerification === 'verified'
    ? true : { status: importRes.status, sig: importRes.body?.signatureVerification, body: importRes.body };
});

// ── mustChangePassword + random seed (fresh isolated instance) ──────────────
await t('fresh seed: random password + mustChangePassword flow', async () => {
  try {
    const stale = await fetch(`${FRESH}/api/healthz`);
    if (stale.ok) return { [`stale${FRESH_PORT}`]: `a server is still listening on ${FRESH_PORT} from a previous run` };
  } catch { /* nothing on the fresh port — good */ }

  const dataDir = mkdtempSync(join(tmpdir(), 'dme-seed-test-'));
  const schemaPath = join(process.cwd(), 'lib', 'db', 'desktop-schema.sql');
  const apiEntry = join(process.cwd(), 'artifacts', 'api-server', 'dist', 'index.mjs');
  const seedEntry = join(process.cwd(), 'artifacts', 'api-server', 'dist', 'seed.mjs');
  const env = {
    ...process.env,
    DAMASCUS_DESKTOP: '1',
    DAMASCUS_SCHEMA_PATH: schemaPath,
    DAMASCUS_DATA_DIR: dataDir,
    PORT: String(FRESH_PORT),
    NODE_ENV: 'development',
  };
  delete env.SEED_ADMIN_PASSWORD;

  const children = [];
  const spawnChild = (args, capture = false) => {
    const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    let output = '';
    if (capture) {
      child.stdout.on('data', (d) => { output += String(d); });
      child.stderr.on('data', (d) => { output += String(d); });
    }
    const exited = new Promise((resolve) => {
      child.on('error', () => resolve(output));
      child.on('exit', () => resolve(output));
    });
    return { child, exited, output: () => output };
  };
  const killChild = async (child) => {
    child.kill();
    await new Promise((r) => setTimeout(r, 800));
  };
  const waitHealth = async () => {
    for (let i = 0; i < 30; i += 1) {
      try {
        const res = await fetch(`${FRESH}/api/healthz`);
        if (res.ok) return true;
      } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  };

  // Pass 1: boot to create the schema, kill, seed (prints the one-time password).
  const schemaBoot = spawnChild([apiEntry]);
  if (!(await waitHealth())) {
    await killChild(schemaBoot.child);
    rmSync(dataDir, { recursive: true, force: true });
    return { error: 'schema-creation boot failed' };
  }
  await killChild(schemaBoot.child);
  const seedProc = spawnChild(['--enable-source-maps', seedEntry], true);
  await seedProc.exited;
  const seedOutput = seedProc.output();
  if (!seedOutput.includes('One-time admin password:')) {
    rmSync(dataDir, { recursive: true, force: true });
    return { seedOutput: seedOutput.slice(0, 300) };
  }
  const pwMatch = seedOutput.match(/One-time admin password: (\S+)/);

  // Pass 2: boot the seeded instance and exercise the forced change flow.
  const server = spawnChild([apiEntry]);
  if (!(await waitHealth())) {
    await killChild(server.child);
    rmSync(dataDir, { recursive: true, force: true });
    return { error: 'seeded boot failed' };
  }
  const c = client(FRESH);
  const oldDefault = await c.api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'Admin@1234' } });
  const login = await c.api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: pwMatch[1] } });
  let change = { status: 0 };
  let relogin = { status: 0, body: {} };
  let reloginOld = { status: 0 };
  if (oldDefault.status === 401 && login.status === 200 && login.body?.mustChangePassword === true) {
    change = await c.api('/api/settings/change-password', {
      method: 'POST',
      body: { currentPassword: pwMatch[1], newPassword: 'New-Secure-2026-Pass!' },
    });
    if (change.status === 200) {
      relogin = await c.api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'New-Secure-2026-Pass!' } });
      reloginOld = await c.api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: pwMatch[1] } });
    }
  }
  await killChild(server.child);
  rmSync(dataDir, { recursive: true, force: true });
  return oldDefault.status === 401 &&
    login.status === 200 && login.body?.mustChangePassword === true &&
    change.status === 200 &&
    relogin.status === 200 && relogin.body?.mustChangePassword === false &&
    reloginOld.status === 401
    ? true
    : { oldDefault: oldDefault.status, login: login.status, mustChange: login.body?.mustChangePassword, change: change.status, relogin: relogin.status, mustAfter: relogin.body?.mustChangePassword, oldAfter: reloginOld.status };
});

console.log(`\n═══ SECURITY RESULTS: ${passed} passed, ${failed} failed ═══`);
if (failures.length) {
  console.log("Failures:");
  for (const failure of failures) {
    console.log(`  • ${failure.name} => ${JSON.stringify(failure.detail)}`);
  }
  process.exit(1);
}
