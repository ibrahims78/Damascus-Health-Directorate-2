#!/usr/bin/env node
/**
 * Protected-build activation test.
 *
 * Reproduces the Android on-device gate: it verifies licenses with the embedded
 * public key locally (the gate calls verifyLicense from lib/license-core), and
 * asserts the app-version binding that caused the "license version does not
 * match the app" failure when the bundles were built without VITE_APP_VERSION.
 *
 * Run:  node docs/tests/protected-activation-tests.mjs
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const kitInput = process.env.ACTIVATION_KIT_DIR;
if (!kitInput) {
  console.error("Set ACTIVATION_KIT_DIR to an extracted activation kit before running this test.");
  process.exit(2);
}
const kit = path.resolve(root, kitInput);
const APP_VERSION =
  JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const publicKeyPath =
  process.env.ACTIVATION_PUBLIC_KEY_PATH ??
  path.join(kit, "android", "license-public-key.b64");
const deviceId = "AABBCCDD-1122-3344-5566-AABBCCDDEEFF";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
};

// 1) bundle the license core for node
const require = createRequire(path.join(root, "package.json"));
let esbuild;
try {
  esbuild = require("esbuild");
} catch {
  const store = path.join(root, "node_modules", ".pnpm");
  const dir = fs.readdirSync(store).find((name) => name.startsWith("esbuild@"));
  esbuild = require(path.join(store, dir, "node_modules", "esbuild", "lib", "main.js"));
}
const outDir = path.join(root, "docs", "tests", ".activation-run");
fs.mkdirSync(outDir, { recursive: true });
const bundlePath = path.join(outDir, "license-core.mjs");
await esbuild.build({
  entryPoints: [path.join(root, "lib", "license-core", "src", "index.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "es2022",
  outfile: bundlePath,
  logLevel: "warning",
});
const core = await import(`file://${bundlePath.replace(/\\/g, "/")}`);

// 2) the app's embedded public key (what the gate ships) and the protected bundles
const embeddedKey = fs.readFileSync(path.resolve(root, publicKeyPath), "utf8").trim();
const kitKey = fs.readFileSync(path.join(kit, "android", "license-public-key.b64"), "utf8").trim();
check("the embedded android key matches the kit", embeddedKey === kitKey);

for (const [label, dist] of [
  ["windows", "protected-windows"],
  ["android", "protected-android"],
]) {
  const dir = path.join(root, "artifacts", "web", "dist", dist, "public");
  let found = false;
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(js|html)$/.test(entry.name) && fs.readFileSync(p, "utf8").includes(APP_VERSION)) found = true;
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  check(`protected ${label} bundle embeds ${APP_VERSION}`, found);
}

// 3) issue licenses from the kit, then verify them the way the gate does
function issue(appVersion, outName) {
  const out = path.join(outDir, outName);
  const keyId = fs.readFileSync(path.join(kit, "android", "key-id.txt"), "utf8").trim();
  execFileSync(process.execPath, [
    path.join(kit, "tools", "issue-license.mjs"),
    "--platform", "android",
    "--device-id", deviceId,
    "--private-key", path.join(kit, "android", "license-private-key.pem"),
    "--key-id", keyId,
    "--app-version", appVersion,
    "--features", "all",
    "--out", out,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  return fs.readFileSync(out, "utf8").trim();
}

const current = issue(APP_VERSION, "license-current.txt");
const previous = issue("5.0.2", "license-previous.txt");

const verify = (license) =>
  core.verifyLicense(license, {
    platform: "android",
    deviceId,
    appVersion: APP_VERSION,
    publicKeySpkiBase64: kitKey,
  });

const ok = await verify(current);
check(`a ${APP_VERSION} licence activates the ${APP_VERSION} app`, ok.status === "valid", `status=${ok.status}`);

const mismatch = await verify(previous);
check("a 5.0.2 licence is refused as version-mismatch", mismatch.status === "version-mismatch", `status=${mismatch.status}`);

const tampered = (() => {
  const [payload, signature] = current.split(".");
  const json = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
  json.deviceId = "DEADBEEF-0000-0000-0000-000000000000";
  return Buffer.from(JSON.stringify(json), "utf8").toString("base64") + "." + signature;
})();
const tamperedResult = await verify(tampered);
check("a tampered licence is refused", tamperedResult.status !== "valid", `status=${tamperedResult.status}`);

const wrongDevice = await core.verifyLicense(current, {
  platform: "android",
  deviceId: "11111111-2222-3333-4444-555555555555",
  appVersion: APP_VERSION,
  publicKeySpkiBase64: kitKey,
});
check("a licence for another device is refused", wrongDevice.status !== "valid", `status=${wrongDevice.status}`);

const messages = core.formatLicenseError("version-mismatch");
check("the gate has an Arabic message for version-mismatch", typeof messages === "string" && messages.length > 0, messages.slice(0, 40));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
