#!/usr/bin/env node
/**
 * Generate the single Ed25519 key used to issue protected-release licenses.
 *
 * The private key is intentionally written outside the repository:
 *   ~/.config/damascus-emergency-inventory/protected-license-key.b64
 *
 * The public key is safe to commit and is written into License Core so the
 * protected app can verify licenses. Package signing (Android/Windows) is a
 * separate concern and is deliberately not handled by this script.
 */
import { generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const force = process.argv.includes("--force");
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDir, "..");
const licenseCorePath = join(repositoryRoot, "lib/license-core/src/index.ts");
const keyDirectory = join(homedir(), ".config/damascus-emergency-inventory");
const privateKeyPath = join(keyDirectory, "protected-license-key.b64");

if (existsSync(privateKeyPath) && !force) {
  throw new Error(
    `A protected license key already exists at ${privateKeyPath}. ` +
      "Use --force only when deliberately rotating the key.",
  );
}

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privateKeyBase64 = privateKey
  .export({ format: "der", type: "pkcs8" })
  .toString("base64");
const publicKeyBase64 = publicKey
  .export({ format: "der", type: "spki" })
  .toString("base64");

mkdirSync(keyDirectory, { recursive: true, mode: 0o700 });
writeFileSync(privateKeyPath, `${privateKeyBase64}\n`, { mode: 0o600 });
chmodSync(keyDirectory, 0o700);
chmodSync(privateKeyPath, 0o600);

const source = readFileSync(licenseCorePath, "utf8");
const updated = source.replace(
  /export const LICENSE_PUBLIC_KEY_SPKI_BASE64 =\n\s+"[^"]+";/,
  `export const LICENSE_PUBLIC_KEY_SPKI_BASE64 =\n  "${publicKeyBase64}";`,
);
if (updated === source) {
  throw new Error("Could not locate the License Core public-key constant.");
}
writeFileSync(licenseCorePath, updated);

console.log("Protected license key created.");
console.log(`Private key: ${privateKeyPath}`);
console.log("The private key was not printed and must not be committed or shared.");
console.log("");
console.log("Save the contents of that file as the Replit Secret:");
console.log("  DAMASCUS_LICENSE_PRIVATE_KEY_B64");
console.log("");
console.log("The public key was updated in:");
console.log("  lib/license-core/src/index.ts");
console.log("");
console.log("Important: this key opens the protected app license only.");
console.log("Android APK and Windows package signing remain separate release controls.");