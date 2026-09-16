#!/usr/bin/env node
/**
 * Two-factor authentication (TOTP) integration test.
 *
 * Run:  node docs/tests/two-factor-tests.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const apiDir = path.join(root, "artifacts", "api-server");
const dataDir = path.join(root, "docs", "tests", ".twofactor-run", `run-${Date.now()}`);
fs.mkdirSync(dataDir, { recursive: true });
const PORT = 41991;
const base = `http://127.0.0.1:${PORT}`;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
};

let cookie = "";
async function req(method, p, body) {
  const res = await fetch(base + p, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

// ---- the same algorithm the server uses (verified against the RFC vectors) ----
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Decode(input) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
function totp(secret, at = Date.now()) {
  const counter = Math.floor(at / 1000 / 30);
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buffer.writeUInt32BE(counter % 0x100000000, 4);
  const digest = crypto.createHmac("sha1", base32Decode(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1000000).padStart(6, "0");
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
  check("login works before enabling 2FA", (await req("POST", "/api/auth/login", { username: "admin", password: "Admin@1234567" })).status === 200);

  const setup = await req("POST", "/api/auth/2fa/setup", {});
  const secret = setup.data?.secret ?? "";
  check("2fa: setup issues a base32 secret", setup.status === 200 && /^[A-Z2-7]{16,}$/.test(secret), `secret=${secret.slice(0, 6)}...`);
  check("2fa: setup returns an otpauth uri", String(setup.data?.otpauthUri ?? "").startsWith("otpauth://totp/"));

  const badEnable = await req("POST", "/api/auth/2fa/enable", { code: "000000" });
  check("2fa: enabling with a wrong code is refused", badEnable.status === 400, `status=${badEnable.status}`);

  const code = totp(secret);
  const enable = await req("POST", "/api/auth/2fa/enable", { code });
  check("2fa: enabling with the correct code succeeds", enable.status === 200 && enable.data?.enabled === true, `status=${enable.status}`);
  check("2fa: status reports enabled", (await req("GET", "/api/auth/2fa/status")).data?.enabled === true);

  await req("POST", "/api/auth/logout", {});
  cookie = "";

  const noCode = await req("POST", "/api/auth/login", { username: "admin", password: "Admin@1234567" });
  check("2fa: login without a code is refused", noCode.status === 401 && noCode.data?.twoFactorRequired === true, `status=${noCode.status}`);

  const wrongCode = await req("POST", "/api/auth/login", { username: "admin", password: "Admin@1234567", code: "000000" });
  check("2fa: login with a wrong code is refused", wrongCode.status === 401 && wrongCode.data?.twoFactorRequired === true, `status=${wrongCode.status}`);

  const withCode = await req("POST", "/api/auth/login", { username: "admin", password: "Admin@1234567", code: totp(secret) });
  check("2fa: login with the correct code succeeds", withCode.status === 200 && Boolean(withCode.data?.csrfToken), `status=${withCode.status}`);
  check("2fa: the session is valid after the second factor", (await req("GET", "/api/auth/me")).status === 200);

  const disable = await req("POST", "/api/auth/2fa/disable", { code: totp(secret) });
  check("2fa: disabling with the correct code succeeds", disable.status === 200 && disable.data?.enabled === false, `status=${disable.status}`);

  await req("POST", "/api/auth/logout", {});
  cookie = "";
  const afterDisable = await req("POST", "/api/auth/login", { username: "admin", password: "Admin@1234567" });
  check("2fa: login without a code works again after disabling", afterDisable.status === 200, `status=${afterDisable.status}`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  fs.writeFileSync(path.join(root, "docs", "tests", ".twofactor-run", "results.txt"), results.map((r) => `${r.ok ? "PASS" : "FAIL"}  ${r.name}`).join("\n") + "\n", "utf8");
  exitCode = failed.length ? 1 : 0;
} catch (error) {
  console.error("TEST RUN FAILED:", error);
  exitCode = 1;
} finally {
  child.kill();
  await new Promise((r) => setTimeout(r, 700));
}
process.exit(exitCode);
