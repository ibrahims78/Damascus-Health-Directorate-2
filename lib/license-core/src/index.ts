export const LICENSE_FORMAT = "dme-license";
export const LICENSE_VERSION = 1;
export const LICENSE_PUBLIC_KEY_SPKI_BASE64 =
  "MCowBQYDK2VwAyEA/iZ+q9UqglUUy+KOzzN0bNZUGMd1p7IwS0hCOF0QR1g=";

export type LicensePlatform = "android" | "windows";

export type LicensePayload = {
  format: typeof LICENSE_FORMAT;
  version: typeof LICENSE_VERSION;
  keyId: string;
  product: "damascus-emergency-inventory";
  platform: LicensePlatform;
  deviceId: string;
  licenseId: string;
  issuedAt: string;
  expiresAt: string | null;
  appVersion: string;
  features: string[];
};

export type SignedLicense = {
  payload: LicensePayload;
  signature: string;
};

export type LicenseStatus =
  | "valid"
  | "missing"
  | "invalid"
  | "expired"
  | "device-mismatch"
  | "platform-mismatch"
  | "unsupported"
  | "version-mismatch";

export type LicenseResult = {
  status: LicenseStatus;
  license?: LicensePayload;
};

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bytesToBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function canonicalJson(value: LicensePayload): string {
  return JSON.stringify({
    appVersion: value.appVersion,
    deviceId: value.deviceId,
    expiresAt: value.expiresAt,
    features: [...value.features].sort(),
    format: value.format,
    issuedAt: value.issuedAt,
    keyId: value.keyId,
    licenseId: value.licenseId,
    platform: value.platform,
    product: value.product,
    version: value.version,
  });
}

function isPayload(value: unknown): value is LicensePayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LicensePayload>;
  return (
    candidate.format === LICENSE_FORMAT &&
    candidate.version === LICENSE_VERSION &&
    candidate.product === "damascus-emergency-inventory" &&
    (candidate.platform === "android" || candidate.platform === "windows") &&
    typeof candidate.keyId === "string" &&
    typeof candidate.deviceId === "string" &&
    typeof candidate.licenseId === "string" &&
    typeof candidate.issuedAt === "string" &&
    (candidate.expiresAt === null || typeof candidate.expiresAt === "string") &&
    typeof candidate.appVersion === "string" &&
    Array.isArray(candidate.features) &&
    candidate.features.every((feature) => typeof feature === "string")
  );
}

export function encodeLicense(value: SignedLicense): string {
  return `${btoa(canonicalJson(value.payload))}.${value.signature}`;
}

import * as ed25519 from "@noble/ed25519";

// Noble needs an SHA-512 implementation — WebCrypto SHA-512 is available in
// every environment (unlike Ed25519 itself, which older Chromium/WebView2
// builds lack).
ed25519.hashes.sha512Async = async (message: Uint8Array) =>
  new Uint8Array(await crypto.subtle.digest("SHA-512", message as BufferSource));

async function verifyEd25519Fallback(
  signatureB64: string,
  canonical: string,
  publicKeySpkiB64: string,
): Promise<boolean | null> {
  try {
    const spki = base64ToBytes(publicKeySpkiB64);
    const rawKey = spki.slice(spki.length - 32);
    const sig = base64ToBytes(signatureB64);
    // A corrupted/truncated paste must read as "invalid" (bad license), not
    // "unsupported" (missing crypto capability) — so length problems are
    // rejected here before the library can throw on them.
    if (sig.length !== 64) return false;
    return await ed25519.verifyAsync(sig, new TextEncoder().encode(canonical), rawKey);
  } catch {
    return null;
  }
}

export function decodeLicense(value: string): SignedLicense | null {
  try {
    const [payloadEncoded, signature] = value.trim().split(".");
    if (!payloadEncoded || !signature) return null;
    const payload = JSON.parse(atob(payloadEncoded)) as unknown;
    if (!isPayload(payload) || !/^[A-Za-z0-9+/=]+$/.test(signature)) return null;
    return { payload, signature };
  } catch {
    return null;
  }
}

async function importPublicKey(publicKeySpkiBase64?: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    base64ToBytes(publicKeySpkiBase64 ?? LICENSE_PUBLIC_KEY_SPKI_BASE64) as BufferSource,
    { name: "Ed25519" } as AlgorithmIdentifier,
    false,
    ["verify"],
  );
}

export async function verifyLicense(
  encoded: string | null | undefined,
  expected: {
    platform: LicensePlatform;
    deviceId: string;
    appVersion?: string;
    /** Per-platform pinned key override (release builds inject their platform key). */
    publicKeySpkiBase64?: string;
  },
): Promise<LicenseResult> {
  if (!encoded) return { status: "missing" };
  const decoded = decodeLicense(encoded);
  if (!decoded) return { status: "invalid" };
  const { payload, signature } = decoded;

  if (payload.platform !== expected.platform) return { status: "platform-mismatch" };
  if (payload.deviceId !== expected.deviceId) return { status: "device-mismatch" };
  if (expected.appVersion && payload.appVersion !== "*" && payload.appVersion !== expected.appVersion) {
    return { status: "version-mismatch", license: payload };
  }
  if (payload.expiresAt && Date.parse(payload.expiresAt) <= Date.now()) {
    return { status: "expired", license: payload };
  }

  const canonical = new TextEncoder().encode(canonicalJson(payload));
  try {
    // Fast path: native WebCrypto Ed25519 (modern Chromium/WebView2).
    const valid = await crypto.subtle.verify(
      { name: "Ed25519" } as AlgorithmIdentifier,
      await importPublicKey(expected.publicKeySpkiBase64),
      base64ToBytes(signature) as BufferSource,
      canonical,
    );
    return valid ? { status: "valid", license: payload } : { status: "invalid" };
  } catch {
    // Slow path: pure-JS Ed25519 for environments whose WebCrypto lacks
    // Ed25519 (older WebView2/Chromium). Returns null when the fallback
    // itself cannot run.
    const fallback = await verifyEd25519Fallback(
      signature,
      canonicalJson(payload),
      expected.publicKeySpkiBase64 ?? LICENSE_PUBLIC_KEY_SPKI_BASE64,
    );
    if (fallback === true) return { status: "valid", license: payload };
    if (fallback === false) return { status: "invalid" };
    return { status: "unsupported" };
  }
}

export function getInstallDeviceId(storage: Storage, storageKey: string): string {
  const existing = storage.getItem(storageKey);
  if (existing) return existing;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const id = `DME-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`.toUpperCase();
  storage.setItem(storageKey, id);
  return id;
}

export function formatLicenseError(status: LicenseStatus): string {
  switch (status) {
    case "missing": return "لا يوجد ترخيص لهذا الجهاز.";
    case "invalid": return "ملف الترخيص غير صحيح أو تم العبث به.";
    case "expired": return "انتهت صلاحية الترخيص.";
    case "device-mismatch": return "الترخيص صادر لجهاز آخر.";
    case "platform-mismatch": return "الترخيص صادر لمنصة أخرى.";
    case "unsupported": return "الترخيص غير متوافق مع إصدار التطبيق.";
    case "version-mismatch": return "إصدار الترخيص لا يطابق إصدار التطبيق. أعد إصدار الترخيص."
    default: return "";
  }
}