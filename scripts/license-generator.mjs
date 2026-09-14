#!/usr/bin/env node
import { createPrivateKey, randomUUID, sign } from "node:crypto";

const PRIVATE_KEY_ENV = "DAMASCUS_LICENSE_PRIVATE_KEY_B64";
const [platform = "android", deviceId, appVersion = "4.3.0", expiresAt = ""] =
  process.argv.slice(2);

if (platform !== "android" && platform !== "windows") {
  throw new Error("Usage: node scripts/license-generator.mjs <android|windows> <device-id> [app-version] [expires-at]");
}
if (!deviceId) throw new Error("A device ID is required.");
const privateKeyBase64 = process.env[PRIVATE_KEY_ENV];
if (!privateKeyBase64) {
  throw new Error(`${PRIVATE_KEY_ENV} must be provided through a secure environment.`);
}

const payload = {
  format: "dme-license",
  version: 1,
  keyId: process.env.DAMASCUS_LICENSE_KEY_ID || "dme-ed25519-2026-01",
  product: "damascus-emergency-inventory",
  platform,
  deviceId: deviceId.trim().toUpperCase(),
  licenseId: randomUUID(),
  issuedAt: new Date().toISOString(),
  expiresAt: expiresAt || null,
  appVersion,
  features: ["inventory", "reports", "backup", "sync"],
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
const key = createPrivateKey({
  key: Buffer.from(privateKeyBase64, "base64"),
  format: "der",
  type: "pkcs8",
});
const signature = sign(null, Buffer.from(canonical, "utf8"), key).toString("base64");
console.log(`${Buffer.from(canonical, "utf8").toString("base64")}.${signature}`);