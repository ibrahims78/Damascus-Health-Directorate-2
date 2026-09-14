import { Router } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db, licenseStateTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { auditLog } from "../middlewares/audit";

/**
 * Machine-bound licensing for the PROTECTED desktop build.
 *
 * The license belongs to the MACHINE (this API server), not to any browser:
 *  - the server generates a stable deviceId once (persisted in license_state)
 *  - the activation screen shows that deviceId
 *  - the vendor issues a signed license bound to it (KeyGenerator)
 *  - activation stores the license server-side, so EVERY browser/window on
 *    this machine is activated together.
 */

const router = Router();

const LICENSE_PLATFORM = "windows";
const RELEASE_VERSION = process.env.DAMASCUS_RELEASE_VERSION ?? "v4.0.3";
const LICENSE_PUBLIC_KEY_CANDIDATES = [
  process.env.LICENSE_PUBLIC_KEY_FILE,
  path.resolve(import.meta.dirname ?? process.cwd(), "../license-public-key.b64"),
  path.resolve(
    import.meta.dirname ?? process.cwd(),
    `../../../release-artifacts/${RELEASE_VERSION}/license-public-keys/windows.b64`,
  ),
].filter((value): value is string => Boolean(value));

function licensePublicKeyB64(): string {
  for (const candidate of LICENSE_PUBLIC_KEY_CANDIDATES) {
    try {
      return fs.readFileSync(candidate, "utf8").trim();
    } catch {
      // try the next candidate
    }
  }
  return "";
}

function spkiB64ToPem(b64: string): string {
  const der = Buffer.from(b64, "base64");
  const lines = der.toString("base64").match(/.{1,64}/g) ?? [];
  return "-----BEGIN PUBLIC KEY-----\n" + lines.join("\n") + "\n-----END PUBLIC KEY-----\n";
}

async function getLicenseRow() {
  const rows = await db.select().from(licenseStateTable).where(eq(licenseStateTable.id, 1)).limit(1);
  return rows[0] ?? null;
}

async function getOrCreateDeviceId(): Promise<string> {
  const row = await getLicenseRow();
  if (row?.deviceId) return row.deviceId;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const id = `DME-${hex.slice(0, 8).toUpperCase()}-${hex.slice(8, 12).toUpperCase()}-${hex
    .slice(12, 16)
    .toUpperCase()}-${hex.slice(16, 20).toUpperCase()}-${hex.slice(20, 32).toUpperCase()}`;
  await db.insert(licenseStateTable).values({ deviceId: id });
  return id;
}

function canonicalLicensePayload(payload: Record<string, unknown>): string {
  return JSON.stringify({
    appVersion: payload.appVersion,
    deviceId: payload.deviceId,
    expiresAt: payload.expiresAt,
    features: [...((payload.features as string[]) ?? [])].sort(),
    format: payload.format,
    issuedAt: payload.issuedAt,
    keyId: payload.keyId,
    licenseId: payload.licenseId,
    platform: payload.platform,
    product: payload.product,
    version: payload.version,
  });
}

type LicenseVerifyResult = { status: string; license?: Record<string, unknown> };

async function verifyLicense(
  encoded: string,
  expected: { platform: string; deviceId: string; publicKeySpkiB64?: string },
): Promise<LicenseVerifyResult> {
  let payload: Record<string, unknown>;
  let signature: string;
  try {
    const [pb64, sig] = encoded.trim().split(".");
    if (!pb64 || !sig) return { status: "invalid" };
    if (!/^[A-Za-z0-9+/=]+$/.test(sig)) return { status: "invalid" };
    payload = JSON.parse(Buffer.from(pb64, "base64").toString("utf8"));
    signature = sig;
  } catch {
    return { status: "invalid" };
  }
  if (!isPayload(payload)) return { status: "invalid" };
  if (payload.platform !== expected.platform) return { status: "platform-mismatch" };
  if (payload.deviceId !== expected.deviceId) return { status: "device-mismatch" };
  if (payload.expiresAt && Date.parse(String(payload.expiresAt)) <= Date.now()) {
    return { status: "expired", license: payload };
  }
  const pubB64 = expected.publicKeySpkiB64 ?? licensePublicKeyB64();
  if (!pubB64) return { status: "unsupported" };
  const canonical = canonicalLicensePayload(payload);
  let valid = false;
  try {
    valid = crypto.verify(
      null,
      Buffer.from(canonical, "utf8"),
      crypto.createPublicKey(spkiB64ToPem(pubB64)),
      Buffer.from(signature, "base64"),
    );
  } catch {
    return { status: "invalid" };
  }
  return valid ? { status: "valid", license: payload } : { status: "invalid" };
}

function isPayload(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// GET /api/license/status - public (the gate shows before login)
router.get("/status", async (_req, res) => {
  try {
    const deviceId = await getOrCreateDeviceId();
    const row = await getLicenseRow();
    if (!row?.license) {
      res.json({ deviceId, activated: false, status: "missing" });
      return;
    }
    const result = await verifyLicense(row.license, {
      platform: LICENSE_PLATFORM,
      deviceId,
      publicKeySpkiB64: licensePublicKeyB64(),
    });
    res.json({
      deviceId,
      activated: result.status === "valid",
      status: result.status,
      license: result.license ?? null,
    });
  } catch (error) {
    logger.error({ error }, "license status failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/license/activate - public (the activation screen shows before login)
router.post("/activate", async (req, res) => {
  try {
    const license = String(req.body?.license ?? "").trim();
    if (!license) {
      res.status(400).json({ error: "license مطلوب" });
      return;
    }
    const deviceId = await getOrCreateDeviceId();
    const result = await verifyLicense(license, {
      platform: LICENSE_PLATFORM,
      deviceId,
      publicKeySpkiB64: licensePublicKeyB64(),
    });
    if (result.status !== "valid") {
      res.status(400).json({ status: result.status, message: "الترخيص غير مقبول" });
      return;
    }
    const activatedAt = new Date();
    const existing = await getLicenseRow();
    if (existing) {
      await db
        .update(licenseStateTable)
        .set({ license, activatedAt })
        .where(eq(licenseStateTable.id, existing.id));
    } else {
      await db.insert(licenseStateTable).values({ deviceId, license, activatedAt });
    }
    await auditLog({
      req,
      action: "license_activated",
      entityType: "license",
      details: { deviceId, licenseId: (result.license?.licenseId as string) ?? null },
    });
    res.json({ ok: true, activated: true, license: result.license });
  } catch (error) {
    logger.error({ error }, "license activation failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
