// Offline (Android/IndexedDB) password hashing test: PBKDF2-SHA-256 with
// 310,000 iterations replaces the legacy single-round SHA-256, and legacy
// hashes must still verify (upgrade path).
import { readdirSync } from 'node:fs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const offlineApiTs = join(root, 'artifacts', 'web', 'src', 'lib', 'offline-api.ts');

let passed = 0;
let failed = 0;
const failures = [];

function t(name, result) {
  if (result === true) { passed += 1; console.log(`✅ ${name}`); }
  else { failed += 1; failures.push({ name, detail: result }); console.log(`❌ ${name} => ${JSON.stringify(result)}`); }
}

// Bundle offline-api.ts with the workspace esbuild so the browser module can
// be exercised under Node without touching the network or a browser.
const pnpmDir = join(root, 'node_modules', '.pnpm');
const esbuildEntry = readdirSync(pnpmDir).find((n) => n.startsWith('esbuild@'));
if (!esbuildEntry) throw new Error('esbuild not found in pnpm store');
const esbuildMain = join(pnpmDir, esbuildEntry, 'node_modules', 'esbuild', 'lib', 'main.js');
const { build } = await import(pathToFileURL(esbuildMain).href);

const tmp = mkdtempSync(join(tmpdir(), 'dme-offline-test-'));
const bundleOut = join(tmp, 'offline-api.mjs');
await build({
  entryPoints: [offlineApiTs],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundleOut,
  logLevel: 'silent',
  banner: { js: `globalThis.window = globalThis.window ?? globalThis;` },
});

const { passwordHash, verifyPassword } = await import(pathToFileURL(bundleOut).href);

t('hash uses pbkdf2$ format with 310000 iterations', /^pbkdf2\$310000\$[0-9a-f]{64}$/.test(await passwordHash('Sup3r-Secret!', 'salt-1')));

const h1 = await passwordHash('Sup3r-Secret!', 'salt-1');
t('correct password verifies', (await verifyPassword('Sup3r-Secret!', 'salt-1', h1)) === true);
t('wrong password fails', (await verifyPassword('wrong-password', 'salt-1', h1)) === false);
t('wrong salt fails', (await verifyPassword('Sup3r-Secret!', 'salt-2', h1)) === false);

// Legacy single-round SHA-256(salt:password) must still verify (back-compat).
async function legacyHash(password, salt) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${password}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
const legacy = await legacyHash('Old-Pass-1', 'legacy-salt');
t('legacy SHA-256 hash still verifies', (await verifyPassword('Old-Pass-1', 'legacy-salt', legacy)) === true);
t('legacy hash rejects wrong password', (await verifyPassword('Old-Pass-2', 'legacy-salt', legacy)) === false);

t('hashes differ across salts', h1 !== (await passwordHash('Sup3r-Secret!', 'salt-2')));
t('hash output is deterministic per salt+password', h1 === (await passwordHash('Sup3r-Secret!', 'salt-1')));

rmSync(tmp, { recursive: true, force: true });

console.log(`\n═══ OFFLINE PASSWORD RESULTS: ${passed} passed, ${failed} failed ═══`);
if (failed > 0) {
  for (const f of failures) console.log(`  • ${f.name} => ${JSON.stringify(f.detail)}`);
  process.exit(1);
}
