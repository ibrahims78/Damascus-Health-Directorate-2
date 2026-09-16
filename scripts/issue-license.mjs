#!/usr/bin/env node
/**
 * License issuer - signs a platform-bound license with the release private key.
 *
 * Usage:
 *   node scripts/issue-license.mjs --platform windows|android \
 *     --device-id <deviceId-from-the-client-gate> \
 *     [--private-key release-secrets-v4.0.3/<platform>/license-private-key.pem] \
 *     [--key-id <keyId>] [--expires 2027-12-31] [--app-version "*"] \
 *     [--features all] [--out license.txt]
 *
 * The produced string is pasted into the protected build's activation screen.
 * The private key never leaves release-secrets/ (gitignored).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const platform = arg("platform");
const deviceId = arg("device-id");
if (!platform || !["windows", "android"].includes(platform)) {
  console.error("usage: --platform windows|android --device-id <id> [--private-key path] [--expires date] [--out file]");
  process.exit(1);
}
if (!deviceId) {
  console.error("usage: --device-id <deviceId shown on the client activation screen>");
  process.exit(1);
}
const root = path.resolve(import.meta.dirname ?? process.cwd(), "..");
const releaseVersion = process.env.DAMASCUS_RELEASE_VERSION ?? "v4.0.3";
const externalSecretsRoot = process.env.DAMASCUS_RELEASE_SECRETS_DIR;
const privateKeyPath = path.resolve(
  arg("private-key") ??
    (externalSecretsRoot
      ? path.join(externalSecretsRoot, platform, "license-private-key.pem")
      : path.join(root, "release-artifacts", releaseVersion, "release-secrets", platform, "license-private-key.pem")),
);
const keyId = arg("key-id") ?? fs.readFileSync(path.join(path.dirname(privateKeyPath), "key-id.txt"), "utf8").trim();
const expiresAt = arg("expires") ?? null;
const appVersion = arg("app-version") ?? "5.0.0";
const features = (arg("features") ?? "all").split(",").map((f) => f.trim()).filter(Boolean);
const outPath = arg("out");

const payload = {
  format: "dme-license",
  version: 1,
  keyId,
  product: "damascus-emergency-inventory",
  platform,
  deviceId,
  licenseId: crypto.randomUUID(),
  issuedAt: new Date().toISOString(),
  expiresAt,
  appVersion,
  features,
};

const canonical = JSON.stringify({
  appVersion: payload.appVersion,
  deviceId: payload.deviceId,
  expiresAt: payload.expiresAt,
  features: [...payload.features].sort(),
  format: payload.format,
  issuedAt: payload.issuedAt,
  keyId: payload.keyId,
  licenseId: payload.licenseId,
  platform: payload.platform,
  product: payload.product,
  version: payload.version,
});

const signature = crypto
  .sign(null, Buffer.from(canonical, "utf8"), crypto.createPrivateKey(fs.readFileSync(privateKeyPath, "utf8")))
  .toString("base64");

const license = `${Buffer.from(canonical, "utf8").toString("base64")}.${signature}`;
if (outPath) {
  fs.writeFileSync(outPath, license + "\n");
  console.log(`license written to ${outPath}`);
} else {
  console.log(license);
}
console.error(`licenseId=${payload.licenseId} platform=${platform} device=${deviceId} expires=${expiresAt ?? "never"}`);