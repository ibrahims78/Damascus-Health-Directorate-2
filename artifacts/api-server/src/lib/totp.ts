import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * TOTP (RFC 6238) / HOTP (RFC 4226) implemented on node:crypto.
 *
 * Kept dependency-free on purpose: the offline build environment cannot fetch
 * packages, and a hand-checked implementation is verified against the RFC test
 * vectors (see lib/totp.test.ts).
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/g, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error("INVALID_BASE32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

/** A 160-bit secret (RFC 4226 recommends 20 bytes), base32 encoded. */
export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

/** RFC 4226 HOTP: truncate the HMAC-SHA1 digest modulo 10^digits. */
export function hotp(secretBase32: string, counter: number, digits = 6): string {
  const key = base32Decode(secretBase32);
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buffer.writeUInt32BE(counter % 0x100000000, 4);
  const digest = createHmac("sha1", key).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** RFC 6238 TOTP with a 30 second step. */
export function totp(secretBase32: string, at: Date | number = Date.now(), stepSeconds = 30, digits = 6): string {
  const millis = typeof at === "number" ? at : at.getTime();
  const counter = Math.floor(millis / 1000 / stepSeconds);
  return hotp(secretBase32, counter, digits);
}

/** Verifies a token allowing ±window steps for clock drift. */
export function verifyTotp(
  secretBase32: string,
  token: string,
  options: { at?: Date | number; window?: number; stepSeconds?: number; digits?: number } = {},
): boolean {
  const digits = options.digits ?? 6;
  const candidate = String(token ?? "").replace(/\s+/g, "");
  if (!new RegExp(`^\\d{${digits}}$`).test(candidate)) return false;
  const at = options.at ?? Date.now();
  const window = options.window ?? 1;
  const stepSeconds = options.stepSeconds ?? 30;
  const millis = typeof at === "number" ? at : at.getTime();
  const counter = Math.floor(millis / 1000 / stepSeconds);
  for (let offset = -window; offset <= window; offset += 1) {
    const expected = hotp(secretBase32, counter + offset, digits);
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(candidate, "utf8");
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

/** otpauth:// URI that authenticator apps understand. */
export function totpUri(secretBase32: string, account: string, issuer = "Damascus Health Directorate"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret: secretBase32, issuer, algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${label}?${params.toString()}`;
}
