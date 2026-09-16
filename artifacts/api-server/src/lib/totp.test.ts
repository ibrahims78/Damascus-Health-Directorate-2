import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, generateTotpSecret, hotp, totp, totpUri, verifyTotp } from "./totp";

/** RFC 4226 (HOTP) and RFC 6238 (TOTP) reference vectors. */
const RFC_SECRET_ASCII = "12345678901234567890";
const RFC_SECRET_BASE32 = base32Encode(Buffer.from(RFC_SECRET_ASCII, "utf8"));

describe("TOTP/HOTP (RFC 4226 / RFC 6238)", () => {
  it("encodes and decodes base32 round-trip", () => {
    expect(base32Decode(RFC_SECRET_BASE32).toString("utf8")).toBe(RFC_SECRET_ASCII);
    const random = generateTotpSecret();
    expect(base32Decode(random).length).toBe(20);
  });

  it("matches the RFC 4226 HOTP vectors", () => {
    const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
    expected.forEach((value, counter) => {
      expect(hotp(RFC_SECRET_BASE32, counter)).toBe(value);
    });
  });

  it("matches the RFC 6238 TOTP vectors (SHA-1, 8 digits)", () => {
    const vectors: Array<[number, string]> = [
      [59, "94287082"],
      [1111111109, "07081804"],
      [1111111111, "14050471"],
      [1234567890, "89005924"],
      [2000000000, "69279037"],
      [20000000000, "65353130"],
    ];
    for (const [seconds, expected] of vectors) {
      expect(totp(RFC_SECRET_BASE32, seconds * 1000, 30, 8)).toBe(expected);
    }
  });

  it("accepts the current step and rejects wrong tokens", () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    const token = totp(secret, now);
    expect(verifyTotp(secret, token, { at: now })).toBe(true);
    // clock drift of one step in either direction is tolerated
    expect(verifyTotp(secret, token, { at: now + 30_000 })).toBe(true);
    expect(verifyTotp(secret, token, { at: now + 120_000 })).toBe(false);
    expect(verifyTotp(secret, "000000", { at: now })).toBe(token === "000000");
    expect(verifyTotp(secret, "abcdef", { at: now })).toBe(false);
  });

  it("builds an otpauth uri for authenticator apps", () => {
    const uri = totpUri("ABCDEF234567", "admin", "Damascus Health Directorate");
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(uri).toContain("secret=ABCDEF234567");
    expect(uri).toContain("issuer=Damascus+Health+Directorate");
  });
});
