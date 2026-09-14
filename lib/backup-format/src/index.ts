import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

const MAGIC = Buffer.from("DME-SYNC\n", "utf8");
const FORMAT_VERSION = 1;
const SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1 };
const DEFAULT_MAX_PACKAGE_BYTES = 512 * 1024 * 1024;
// Version 1 stores the authenticated ciphertext in the JSON envelope. Keep
// the parser bounded by the package limit so legitimate large backups are not
// rejected as "incomplete headers", while still preventing unbounded input.
const HEADER_LIMIT = DEFAULT_MAX_PACKAGE_BYTES;
const SENSITIVE_KEY = /(?:password|passwd|secret|token|session|cookie|private.?key|api.?key|credential)/i;

export type PackageType = "full-backup" | "delta-sync" | "baseline-migration";

export type SyncRecord = {
  entityType: string;
  localId?: number | null;
  globalId?: string | null;
  data: Record<string, unknown>;
};

export type SyncChange = {
  changeId: string;
  operationId: string;
  entityType: string;
  entityGlobalId: string;
  localEntityId?: number | null;
  changeType: string;
  payload: Record<string, unknown>;
  originNodeId: string;
  originSequence: number;
  parentRevision?: string | null;
  createdAt?: string;
};

export type SyncManifest = {
  format: "dme-sync";
  formatVersion: number;
  packageType: PackageType;
  schemaVersion: string;
  createdAt: string;
  sourceNodeId: string;
  changesFile: "changes.jsonl";
  recordsFile: "records.jsonl";
  recordCount: number;
  changeCount: number;
  compression: "gzip";
  encryption: "AES-256-GCM";
  kdf: "scrypt";
  checksumAlgorithm: "SHA-256";
  macAlgorithm: "HMAC-SHA-256";
  baseVector?: Record<string, number>;
  lastVector?: Record<string, number>;
};

export type SyncPackage = {
  manifest: SyncManifest;
  records: SyncRecord[];
  changes: SyncChange[];
  packageHash: string;
  signatureInfo?: {
    signature: string;
    checksum?: string | null;
    signingNodeId?: string | null;
    signingKeyId?: string | null;
    signingPublicKey?: string | null;
  };
};

type PackageHeader = {
  formatVersion: number;
  salt: string;
  iv: string;
  authTag: string;
  checksum: string;
  mac: string;
  ciphertext: string;
  // Optional Ed25519 signature (non-repudiation). Signed over the checksum;
  // lives in the plaintext envelope so it can be added/verified without
  // touching the ciphertext. Unknown to older readers, which ignore it.
  signature?: string;
  signingNodeId?: string;
  signingKeyId?: string;
  signingPublicKey?: string;
};

export class SyncPackageError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "INVALID_PACKAGE"
      | "UNSUPPORTED_VERSION"
      | "INTEGRITY_ERROR"
      | "WRONG_PASSWORD"
      | "SENSITIVE_DATA"
      | "PACKAGE_TOO_LARGE",
  ) {
    super(message);
    this.name = "SyncPackageError";
  }
}

function fail(
  message: string,
  code: ConstructorParameters<typeof SyncPackageError>[1],
): never {
  throw new SyncPackageError(message, code);
}

function deriveKeys(password: string, salt: Buffer) {
  if (!password || password.length < 8) {
    fail("A package password must contain at least 8 characters", "WRONG_PASSWORD");
  }
  const derived = scryptSync(password, salt, 64, SCRYPT_OPTIONS);
  return { encryptionKey: derived.subarray(0, 32), macKey: derived.subarray(32) };
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested) => {
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      return Object.fromEntries(
        Object.entries(nested as Record<string, unknown>).sort(([a], [b]) =>
          a.localeCompare(b),
        ),
      );
    }
    return nested;
  });
}

function inspectKeys(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => inspectKeys(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) {
      fail(`Sensitive field is not allowed in a sync package: ${path}.${key}`, "SENSITIVE_DATA");
    }
    inspectKeys(nested, `${path}.${key}`);
  }
}

function encodePlaintext(manifest: SyncManifest, records: SyncRecord[], changes: SyncChange[]) {
  const lines = [
    canonicalJson({ type: "manifest", manifest }),
    ...changes.map((change) => canonicalJson({ type: "change", change })),
    ...records.map((record) => canonicalJson({ type: "record", record })),
  ];
  return Buffer.from(`${lines.join("\n")}\n`, "utf8");
}

function parsePlaintext(plaintext: Buffer): {
  manifest: SyncManifest;
  records: SyncRecord[];
  changes: SyncChange[];
} {
  const lines = plaintext.toString("utf8").split("\n").filter(Boolean);
  if (lines.length === 0) fail("The package payload is empty", "INVALID_PACKAGE");
  let manifest: SyncManifest | undefined;
  const records: SyncRecord[] = [];
  const changes: SyncChange[] = [];
  try {
    for (const line of lines) {
      const entry = JSON.parse(line) as {
        type?: string;
        manifest?: SyncManifest;
        record?: SyncRecord;
        change?: SyncChange;
      };
      if (entry.type === "manifest") manifest = entry.manifest;
      else if (entry.type === "record" && entry.record) records.push(entry.record);
      else if (entry.type === "change" && entry.change) changes.push(entry.change);
      else fail("Malformed JSONL entry in package", "INVALID_PACKAGE");
    }
  } catch (error) {
    if (error instanceof SyncPackageError) throw error;
    fail("Malformed JSONL payload in package", "INVALID_PACKAGE");
  }
  if (!manifest || manifest.format !== "dme-sync" || manifest.formatVersion !== FORMAT_VERSION) {
    fail("Missing or unsupported package manifest", "UNSUPPORTED_VERSION");
  }
  if (manifest.recordCount !== records.length || manifest.changeCount !== changes.length) {
    fail("Manifest counts do not match the package payload", "INVALID_PACKAGE");
  }
  inspectKeys({ manifest, records, changes });
  return { manifest, records, changes };
}

export function createSyncPackage(input: {
  password: string;
  packageType: PackageType;
  schemaVersion: string;
  sourceNodeId: string;
  records: SyncRecord[];
  changes?: SyncChange[];
  baseVector?: Record<string, number>;
  lastVector?: Record<string, number>;
  createdAt?: string;
}): Buffer {
  const changes = input.changes ?? [];
  const manifest: SyncManifest = {
    format: "dme-sync",
    formatVersion: FORMAT_VERSION,
    packageType: input.packageType,
    schemaVersion: input.schemaVersion,
    createdAt: input.createdAt ?? new Date().toISOString(),
    sourceNodeId: input.sourceNodeId,
    changesFile: "changes.jsonl",
    recordsFile: "records.jsonl",
    recordCount: input.records.length,
    changeCount: changes.length,
    compression: "gzip",
    encryption: "AES-256-GCM",
    kdf: "scrypt",
    checksumAlgorithm: "SHA-256",
    macAlgorithm: "HMAC-SHA-256",
    baseVector: input.baseVector,
    lastVector: input.lastVector,
  };
  inspectKeys({ manifest, records: input.records, changes });
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const { encryptionKey, macKey } = deriveKeys(input.password, salt);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(gzipSync(encodePlaintext(manifest, input.records, changes), { level: 6 })),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const checksum = createHash("sha256").update(ciphertext).digest("hex");
  const mac = createHmac("sha256", macKey)
    .update(Buffer.concat([salt, iv, authTag, ciphertext]))
    .digest("hex");
  const header: PackageHeader = {
    formatVersion: FORMAT_VERSION,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    checksum,
    mac,
    ciphertext: ciphertext.toString("base64"),
  };
  return Buffer.concat([MAGIC, Buffer.from(`${canonicalJson(header)}\n`, "utf8")]);
}

export function readSyncPackage(
  input: Buffer,
  password: string,
  options: { maxBytes?: number } = {},
): SyncPackage {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_PACKAGE_BYTES;
  if (input.length > maxBytes) fail("The sync package exceeds the configured size limit", "PACKAGE_TOO_LARGE");
  if (!Buffer.isBuffer(input) || input.length <= MAGIC.length) {
    fail("The sync package is empty or incomplete", "INVALID_PACKAGE");
  }
  if (!input.subarray(0, MAGIC.length).equals(MAGIC)) {
    fail("The sync package magic header is invalid", "INVALID_PACKAGE");
  }
  const newline = input.indexOf(0x0a, MAGIC.length);
  if (newline === -1 || newline - MAGIC.length > HEADER_LIMIT) {
    fail("The sync package header is incomplete", "INVALID_PACKAGE");
  }
  let header: PackageHeader;
  try {
    header = JSON.parse(input.subarray(MAGIC.length, newline).toString("utf8")) as PackageHeader;
  } catch {
    fail("The sync package header is invalid", "INVALID_PACKAGE");
  }
  if (header.formatVersion !== FORMAT_VERSION || !header.ciphertext) {
    fail("The sync package version is not supported", "UNSUPPORTED_VERSION");
  }
  let salt: Buffer, iv: Buffer, authTag: Buffer, ciphertext: Buffer;
  try {
    salt = Buffer.from(header.salt, "base64");
    iv = Buffer.from(header.iv, "base64");
    authTag = Buffer.from(header.authTag, "base64");
    ciphertext = Buffer.from(header.ciphertext, "base64");
  } catch {
    fail("The sync package binary fields are invalid", "INVALID_PACKAGE");
  }
  if (salt.length !== 16 || iv.length !== 12 || authTag.length !== 16 || ciphertext.length === 0) {
    fail("The sync package is incomplete", "INVALID_PACKAGE");
  }
  const actualChecksum = createHash("sha256").update(ciphertext).digest("hex");
  if (actualChecksum !== header.checksum) fail("The sync package checksum is invalid", "INTEGRITY_ERROR");
  let encryptionKey: Buffer, macKey: Buffer;
  try {
    ({ encryptionKey, macKey } = deriveKeys(password, salt));
  } catch (error) {
    if (error instanceof SyncPackageError) throw error;
    fail("The package password is invalid", "WRONG_PASSWORD");
  }
  const expectedMac = createHmac("sha256", macKey)
    .update(Buffer.concat([salt, iv, authTag, ciphertext]))
    .digest("hex");
  if (
    expectedMac.length !== header.mac?.length ||
    !timingSafeEqual(Buffer.from(expectedMac), Buffer.from(header.mac ?? ""))
  ) {
    fail("The package password is incorrect or the package was tampered with", "WRONG_PASSWORD");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey, iv);
    decipher.setAuthTag(authTag);
    const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const parsed = parsePlaintext(gunzipSync(compressed));
    const packageHash = createHash("sha256").update(input).digest("hex");
    const signatureInfo =
      header.signature && header.signingPublicKey
        ? {
            signature: header.signature,
            checksum: header.checksum,
            signingNodeId: header.signingNodeId ?? null,
            signingKeyId: header.signingKeyId ?? null,
            signingPublicKey: header.signingPublicKey,
          }
        : undefined;
    return { ...parsed, packageHash, ...(signatureInfo ? { signatureInfo } : {}) };
  } catch (error) {
    if (error instanceof SyncPackageError) throw error;
    fail("The package could not be decrypted or decompressed", "INTEGRITY_ERROR");
  }
}

export function packageSummary(pkg: SyncPackage) {
  return {
    packageHash: pkg.packageHash,
    manifest: pkg.manifest,
    recordCount: pkg.records.length,
    changeCount: pkg.changes.length,
    entityTypes: [...new Set(pkg.records.map((record) => record.entityType))].sort(),
  };
}