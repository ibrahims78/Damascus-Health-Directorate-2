#!/usr/bin/env node
/**
 * Build a PROTECTED web bundle for a platform (approved protected-releases
 * plan): injects the platform license public key + platform flag into the
 * bundle so the activation gate verifies licenses signed by that platform's
 * release key.
 *
 * Usage: node scripts/build-protected-web.mjs windows|android
 * Output: artifacts/web/dist/protected-<platform>/public
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const platform = process.argv[2];
if (!["windows", "android"].includes(platform)) {
  console.error("usage: node scripts/build-protected-web.mjs windows|android");
  process.exit(1);
}
const root = path.resolve(import.meta.dirname ?? process.cwd(), "..");
const releaseVersion = process.env.DAMASCUS_RELEASE_VERSION ?? "v4.0.3";
const keyFile = path.join(root, "release-artifacts", releaseVersion, "license-public-keys", `${platform}.b64`);
if (!fs.existsSync(keyFile)) {
  console.error(`platform public key not found: ${keyFile}`);
  process.exit(1);
}
const publicKey = fs.readFileSync(keyFile, "utf8").trim();

const webDir = path.join(root, "artifacts", "web");
const offline = platform === "android" ? "1" : "0";
const outDir = `dist/protected-${platform}/public`;
const env = {
  ...process.env,
  VITE_OFFLINE_MODE: offline,
  VITE_PROTECTED_BUILD: "1",
  VITE_OUTPUT_DIR: outDir,
  VITE_LICENSE_PLATFORM: platform,
  VITE_LICENSE_PUBLIC_KEY: publicKey,
};
const viteEntry = path.join(webDir, "node_modules", "vite", "bin", "vite.js");
const result = spawnSync(process.execPath, [viteEntry, "build", "--config", "vite.config.ts"], {
  cwd: webDir,
  env,
  stdio: "inherit",
});
process.exit(result.status ?? 1);