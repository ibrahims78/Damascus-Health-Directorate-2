import crypto from "node:crypto";
import { db, nodeIdentityTable, syncTrustedNodeTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Ed25519 signing for sync non-repudiation.
 *
 * Each node derives a durable keypair at first use. The private key stays in
 * the node's own database; the public key is shared with trusted peers (and
 * embedded in exported packages). Signatures let a receiver prove that a
 * package/exchange really came from the claimed node, closing the gap where
 * HMAC only proved "someone with the package password".
 */

export type NodeSigningKeys = {
  publicKeyPem: string;
  privateKeyPem: string;
  keyId: string;
};

export function generateNodeSigningKeys(): NodeSigningKeys {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicDer = publicKey.export({ type: "spki", format: "der" });
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    keyId: crypto
      .createHash("sha256")
      .update(publicDer)
      .digest("hex")
      .slice(0, 16),
  };
}

export async function ensureNodeSigningKeys(node: {
  nodeId: string;
  keyId: string | null;
  signingPublicKey: string | null;
  signingPrivateKey: string | null;
}): Promise<NodeSigningKeys> {
  if (node.signingPublicKey && node.signingPrivateKey) {
    return {
      publicKeyPem: node.signingPublicKey,
      privateKeyPem: node.signingPrivateKey,
      keyId: node.keyId ?? "ed25519",
    };
  }
  const keys = generateNodeSigningKeys();
  await db
    .update(nodeIdentityTable)
    .set({
      keyId: keys.keyId,
      signingPublicKey: keys.publicKeyPem,
      signingPrivateKey: keys.privateKeyPem,
      updatedAt: new Date(),
    })
    .where(eq(nodeIdentityTable.nodeId, node.nodeId));
  return keys;
}

export function signPayload(payload: string, privateKeyPem: string): string {
  return crypto
    .sign(null, Buffer.from(payload, "utf8"), crypto.createPrivateKey(privateKeyPem))
    .toString("base64");
}

export function verifyPayload(
  payload: string,
  signatureBase64: string,
  publicKeyPem: string,
): boolean {
  try {
    return crypto.verify(
      null,
      Buffer.from(payload, "utf8"),
      crypto.createPublicKey(publicKeyPem),
      Buffer.from(signatureBase64, "base64"),
    );
  } catch {
    return false;
  }
}

export async function getTrustedPublicKey(
  nodeId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ signingPublicKey: syncTrustedNodeTable.signingPublicKey })
    .from(syncTrustedNodeTable)
    .where(eq(syncTrustedNodeTable.nodeId, nodeId))
    .limit(1);
  return row?.signingPublicKey ?? null;
}

export async function upsertTrustedPublicKey(
  nodeId: string,
  publicKeyPem: string,
  nodeType: string,
): Promise<void> {
  await db
    .insert(syncTrustedNodeTable)
    .values({
      nodeId,
      nodeType: nodeType as never,
      signingPublicKey: publicKeyPem,
    })
    .onConflictDoUpdate({
      target: syncTrustedNodeTable.nodeId,
      set: { signingPublicKey: publicKeyPem, lastSeenAt: new Date() },
    });
}

/** Canonical string signed over by exchange participants. */
export function exchangeSigningPayload(input: {
  nodeId: string;
  signedAt: string;
  vector: Record<string, number>;
  changeCount: number;
}): string {
  return [
    "dme-exchange-v1",
    input.nodeId,
    input.signedAt,
    JSON.stringify(input.vector),
    String(input.changeCount),
  ].join("|");
}

/** Canonical string signed over by exported packages. */
export function packageSigningPayload(checksum: string, packageType: string): string {
  return ["dme-package-v1", packageType, checksum].join("|");
}

/**
 * Append an Ed25519 signature to a .dme-sync envelope without re-encrypting.
 * The signature lives in the plaintext JSON header (signed over the
 * ciphertext checksum); the MAC covers only salt||iv||authTag||ciphertext,
 * so adding envelope fields never invalidates it.
 */
export function signPackageBuffer(
  buffer: Buffer,
  input: { keys: NodeSigningKeys; nodeId: string; packageType: string },
): Buffer {
  const magic = Buffer.from("DME-SYNC\n", "utf8");
  const newline = buffer.indexOf(0x0a, magic.length);
  if (newline < 0) return buffer;
  let header: { checksum?: string };
  try {
    header = JSON.parse(buffer.subarray(magic.length, newline).toString("utf8"));
  } catch {
    return buffer;
  }
  if (!header.checksum) return buffer;
  const signature = signPayload(
    packageSigningPayload(header.checksum, input.packageType),
    input.keys.privateKeyPem,
  );
  const signedHeader = {
    ...header,
    signature,
    signingNodeId: input.nodeId,
    signingKeyId: input.keys.keyId,
    signingPublicKey: input.keys.publicKeyPem,
  };
  return Buffer.concat([
    magic,
    Buffer.from(JSON.stringify(signedHeader), "utf8"),
    Buffer.from("\n", "utf8"),
    buffer.subarray(newline + 1),
  ]);
}
