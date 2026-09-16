// node_modules/.pnpm/@noble+ed25519@3.2.0/node_modules/@noble/ed25519/index.js
var freeze = Object.freeze;
var P = 0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffedn;
var N = 0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3edn;
var _d = 0x52036cee2b6ffe738cc740797779e89800700a4d4141d8ab75eb4dca135978a3n;
var Gx = 0x216936d3cd6e53fec0a4e231fdd6dc5c692cc7609525a7b2c9562d608f25d51an;
var Gy = 0x6666666666666666666666666666666666666666666666666666666666666658n;
var _a = P - 1n;
var ed25519_CURVE = freeze({
  p: P,
  n: N,
  h: 8n,
  a: _a,
  d: _d,
  Gx,
  Gy
});
var LEN = 32;
var isBytes = (a) => {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && a.BYTES_PER_ELEMENT === 1;
};
var abytes = (value, length, title = "") => {
  if (isBytes(value) && (length === void 0 || value.length === length))
    return value;
  const bytes = isBytes(value);
  const ofLen = length !== void 0 ? ` of length ${length}` : "";
  const got = bytes ? `length=${value.length}` : `type=${typeof value}`;
  const message = (title ? `"${title}" ` : "") + "expected Uint8Array" + ofLen + ", got " + got;
  if (!bytes)
    throw new TypeError(message);
  throw new RangeError(message);
};
var snapshotBytes = (value, title = "", length) => Uint8Array.from(abytes(value, length, title));
var padh = (n, pad) => n.toString(16).padStart(pad, "0");
var bytesToHex = (bytes) => {
  let hex = "";
  for (const byte of abytes(bytes))
    hex += padh(byte, 2);
  return hex;
};
var hexToBytes = (hex) => {
  const e = "hex invalid";
  if (typeof hex !== "string")
    throw new TypeError(e);
  if (hex.length % 2 || !/^[\da-f]*$/i.test(hex))
    throw new RangeError(e);
  const array = new Uint8Array(hex.length / 2);
  for (let ai = 0, hi = 0; ai < array.length; ai++, hi += 2) {
    const n1 = hex.charCodeAt(hi);
    const n2 = hex.charCodeAt(hi + 1);
    array[ai] = ((n1 & 15) + (n1 >> 6) * 9) * 16 + (n2 & 15) + (n2 >> 6) * 9;
  }
  return array;
};
var concatBytes = (...arrays) => {
  let sum = 0;
  for (const a of arrays)
    sum += abytes(a).length;
  const res = new Uint8Array(sum);
  let pad = 0;
  for (const a of arrays) {
    res.set(a, pad);
    pad += a.length;
  }
  return res;
};
var arange = (n, min, max, msg = "bad number: out of range") => {
  if (typeof n !== "bigint")
    throw new TypeError(msg);
  if (min <= n && n < max)
    return n;
  throw new RangeError(msg);
};
var mod = (a, b = P) => (a %= b) >= 0n ? a : b + a;
var P_MASK = (1n << 255n) - 1n;
var modP = (num) => {
  if (num < 0n)
    throw new RangeError("negative coordinate");
  let r = (num >> 255n) * 19n + (num & P_MASK);
  r = (r >> 255n) * 19n + (r & P_MASK);
  return r % P;
};
var modN = (a) => mod(a, N);
var invert = (number, modulo) => {
  if (number === 0n)
    throw new Error("invert: expected non-zero number");
  if (modulo <= 1n)
    throw new Error("invert: expected modulus > 1, got " + modulo);
  let a = mod(number, modulo);
  let b = modulo;
  let x = 0n, u = 1n;
  while (a !== 0n) {
    const q = b / a;
    const r = b - a * q;
    const m = x - u * q;
    b = a, a = r, x = u, u = m;
  }
  const gcd = b;
  if (gcd !== 1n)
    throw new Error("invert: does not exist");
  return mod(x, modulo);
};
var _hash = (name) => {
  const fn = hashes[name];
  if (typeof fn !== "function")
    throw new Error("hashes." + name + " not set");
  return fn;
};
var callHashAsync = async (name, ...m) => abytes(await _hash(name)(concatBytes(...m)), 64, "digest");
var apoint = (p) => {
  if (p instanceof Point)
    return p;
  throw new TypeError("Point expected");
};
var B256 = 2n ** 256n;
var Point = class _Point {
  static BASE;
  static ZERO;
  X;
  Y;
  Z;
  T;
  // Constructor only bounds-checks and freezes XYZT coordinates; it does not prove the point is
  // on-curve or that T matches X*Y/Z.
  constructor(X, Y, Z, T) {
    const max = B256;
    this.X = arange(X, 0n, max);
    this.Y = arange(Y, 0n, max);
    this.Z = arange(Z, 1n, max);
    this.T = arange(T, 0n, max);
    freeze(this);
  }
  static CURVE() {
    return ed25519_CURVE;
  }
  static fromAffine(p) {
    return new _Point(p.x, p.y, 1n, modP(p.x * p.y));
  }
  /** RFC8032 5.1.3: Uint8Array to Point. */
  static fromBytes(bytes, zip215 = false) {
    const normed = snapshotBytes(bytes, "point", LEN);
    const lastByte = normed[31];
    normed[31] = lastByte & ~128;
    const y = bytesToNumberLE(normed);
    if (!zip215)
      arange(y, 0n, P);
    const y2 = modP(y * y);
    const u = mod(y2 - 1n);
    const v = modP(_d * y2 + 1n);
    let { isValid, value: x } = uvRatio(u, v);
    if (!isValid)
      throw new Error("bad point: y not sqrt");
    const isLastByteOdd = !!(lastByte & 128);
    if (!zip215 && x === 0n && isLastByteOdd)
      throw new Error("bad point: x==0, isLastByteOdd");
    if (isLastByteOdd !== !!(x & 1n))
      x = mod(-x);
    return new _Point(x, y, 1n, modP(x * y));
  }
  static fromHex(hex, zip215) {
    return _Point.fromBytes(hexToBytes(hex), zip215);
  }
  get x() {
    return this.toAffine().x;
  }
  get y() {
    return this.toAffine().y;
  }
  /** Checks if the point is valid and on-curve. */
  assertValidity() {
    const a = _a;
    const d = _d;
    const p = this;
    if (p.is0())
      throw new Error("bad point: ZERO");
    const { X, Y, Z, T } = p;
    const X2 = modP(X * X);
    const Y2 = modP(Y * Y);
    const Z2 = modP(Z * Z);
    const Z4 = modP(Z2 * Z2);
    const aX2 = modP(X2 * a);
    const left = modP(Z2 * (aX2 + Y2));
    const right = mod(Z4 + modP(d * modP(X2 * Y2)));
    if (left !== right)
      throw new Error("bad point: equation left != right (1)");
    const XY = modP(X * Y);
    const ZT = modP(Z * T);
    if (XY !== ZT)
      throw new Error("bad point: equation left != right (2)");
    return this;
  }
  /** Equality check: compare points P&Q. */
  equals(other) {
    const { X: X1, Y: Y1, Z: Z1 } = this;
    const { X: X2, Y: Y2, Z: Z2 } = apoint(other);
    return modP(X1 * Z2) === modP(X2 * Z1) && modP(Y1 * Z2) === modP(Y2 * Z1);
  }
  is0() {
    return this.equals(I);
  }
  /** Flip point over y coordinate. */
  negate() {
    return new _Point(mod(-this.X), this.Y, this.Z, mod(-this.T));
  }
  /** Point doubling. Complete formula. Cost: `4M + 4S + 1*a + 6add + 1*2`. */
  double() {
    const { X: X1, Y: Y1, Z: Z1 } = this;
    const a = _a;
    const A = modP(X1 * X1);
    const B = modP(Y1 * Y1);
    const C = modP(2n * Z1 * Z1);
    const D = modP(a * A);
    const x1y1 = mod(X1 + Y1);
    const E = mod(modP(x1y1 * x1y1) - A - B);
    const G2 = mod(D + B);
    const F = mod(G2 - C);
    const H = mod(D - B);
    const X3 = modP(E * F);
    const Y3 = modP(G2 * H);
    const T3 = modP(E * H);
    const Z3 = modP(F * G2);
    return new _Point(X3, Y3, Z3, T3);
  }
  /** Point addition. Complete formula. Cost: `9M + 1*a + 1*d + 7add`. */
  add(other) {
    const { X: X1, Y: Y1, Z: Z1, T: T1 } = this;
    const { X: X2, Y: Y2, Z: Z2, T: T2 } = apoint(other);
    const a = _a;
    const d = _d;
    const A = modP(X1 * X2);
    const B = modP(Y1 * Y2);
    const C = modP(modP(T1 * d) * T2);
    const D = modP(Z1 * Z2);
    const E = mod(modP(mod(X1 + Y1) * mod(X2 + Y2)) - A - B);
    const F = mod(D - C);
    const G2 = mod(D + C);
    const H = mod(B - modP(a * A));
    const X3 = modP(E * F);
    const Y3 = modP(G2 * H);
    const T3 = modP(E * H);
    const Z3 = modP(F * G2);
    return new _Point(X3, Y3, Z3, T3);
  }
  subtract(other) {
    return this.add(apoint(other).negate());
  }
  /**
   * Point-by-scalar multiplication. Safe mode requires `1 <= n < CURVE.n`.
   * Unsafe mode additionally permits `n = 0` and returns the identity point for that case.
   * Uses {@link wNAF} for base point.
   * Uses fake point to mitigate side-channel leakage.
   * @param n - scalar by which point is multiplied
   * @param safe - safe mode guards against timing attacks; unsafe mode is faster
   */
  multiply(n, safe = true) {
    if (!safe && n === 0n)
      return I;
    arange(n, 1n, N);
    if (!safe && this.is0())
      return I;
    if (n === 1n)
      return this;
    if (this.equals(G))
      return wNAF(n).p;
    let p = I;
    let f = G;
    let d = this;
    for (let i = 0; safe ? i < 256 : n > 0n; i++) {
      if (n & 1n)
        p = p.add(d);
      else if (safe)
        f = f.add(d);
      d = d.double();
      n >>= 1n;
    }
    return p;
  }
  multiplyUnsafe(scalar) {
    return this.multiply(scalar, false);
  }
  /** Convert point to 2d xy affine point. (X, Y, Z) ∋ (x=X/Z, y=Y/Z) */
  toAffine() {
    const { X, Y, Z } = this;
    if (this.equals(I))
      return { x: 0n, y: 1n };
    const iz = invert(Z, P);
    if (modP(Z * iz) !== 1n)
      throw new Error("invalid inverse");
    return { x: modP(X * iz), y: modP(Y * iz) };
  }
  toBytes() {
    const { x, y } = this.toAffine();
    const b = numTo32bLE(y);
    b[31] |= x & 1n ? 128 : 0;
    return b;
  }
  toHex() {
    return bytesToHex(this.toBytes());
  }
  clearCofactor() {
    return this.multiply(8n, false);
  }
  isSmallOrder() {
    return this.clearCofactor().is0();
  }
  isTorsionFree() {
    return this.multiply(N / 2n, false).double().add(this).is0();
  }
};
var G = new Point(Gx, Gy, 1n, mod(Gx * Gy));
var I = new Point(0n, 1n, 1n, 0n);
Point.BASE = G;
Point.ZERO = I;
var numTo32bLE = (num) => hexToBytes(padh(arange(num, 0n, B256), 64)).reverse();
var bytesToNumberLE = (b) => BigInt("0x" + bytesToHex(Uint8Array.from(abytes(b)).reverse()));
var pow2 = (x, power) => {
  let r = x;
  while (power-- > 0) {
    r = modP(r * r);
  }
  return r;
};
var pow_2_252_3 = (x) => {
  const x2 = modP(x * x);
  const b2 = modP(x2 * x);
  const b4 = modP(pow2(b2, 2) * b2);
  const b5 = modP(pow2(b4, 1) * x);
  const b10 = modP(pow2(b5, 5) * b5);
  const b20 = modP(pow2(b10, 10) * b10);
  const b40 = modP(pow2(b20, 20) * b20);
  const b80 = modP(pow2(b40, 40) * b40);
  const b160 = modP(pow2(b80, 80) * b80);
  const b240 = modP(pow2(b160, 80) * b80);
  const b250 = modP(pow2(b240, 10) * b10);
  return modP(pow2(b250, 2) * x);
};
var RM1 = 0x2b8324804fc1df0b2b4d00993dfbd7a72f431806ad2fe478c4ee1b274a0ea0b0n;
var uvRatio = (u, v) => {
  const v3 = modP(v * modP(v * v));
  const v7 = modP(modP(v3 * v3) * v);
  const pow = pow_2_252_3(modP(u * v7));
  let x = modP(u * modP(v3 * pow));
  const vx2 = modP(v * modP(x * x));
  const root1 = x;
  const root2 = modP(x * RM1);
  const useRoot1 = vx2 === u;
  const useRoot2 = vx2 === mod(-u);
  const noRoot = vx2 === mod(-u * RM1);
  if (useRoot1)
    x = root1;
  if (useRoot2 || noRoot)
    x = root2;
  if ((mod(x) & 1n) === 1n)
    x = mod(-x);
  return { isValid: useRoot1 || useRoot2, value: x };
};
var modL_LE = (hash) => modN(bytesToNumberLE(hash));
var hashFinishAsync = async (res) => res[1](await callHashAsync("sha512Async", res[0]));
var getZip215 = (options) => {
  if (options === null || typeof options !== "object")
    throw new TypeError("expected valid options object");
  return options.zip215 ?? true;
};
var _verify = (sig, msg, publicKey, options) => {
  sig = abytes(sig, 64, "signature");
  msg = abytes(msg, void 0, "message");
  publicKey = abytes(publicKey, LEN, "publicKey");
  const zip215 = getZip215(options);
  const r = sig.subarray(0, LEN);
  const s = bytesToNumberLE(sig.subarray(LEN, 64));
  let A, R, SB;
  let hashable = Uint8Array.of();
  let finished = false;
  try {
    A = Point.fromBytes(publicKey, zip215);
    R = Point.fromBytes(r, zip215);
    SB = G.multiply(s, false);
    hashable = concatBytes(r, publicKey, msg);
    finished = true;
  } catch (error) {
  }
  const finish = (hashed) => {
    if (!finished)
      return false;
    if (!zip215 && A.isSmallOrder())
      return false;
    const k = modL_LE(hashed);
    const RkA = R.add(A.multiply(k, false));
    return RkA.subtract(SB).clearCofactor().is0();
  };
  return [hashable, finish];
};
var verifyAsync = async (signature, message, publicKey, opts = {}) => hashFinishAsync(_verify(signature, message, publicKey, opts));
var hashes = {
  sha512Async: async (message) => {
    const s = globalThis?.crypto?.subtle;
    if (!s)
      throw new Error("crypto.subtle must be defined, consider polyfill");
    return new Uint8Array(await s.digest("SHA-512", concatBytes(message)));
  },
  sha512: void 0
};
var precompute = () => {
  const points = [];
  let p = G;
  let b;
  for (let w = 0; w < 33; w++) {
    b = p;
    points.push(b);
    for (let i = 1; i < 128; i++) {
      b = b.add(p);
      points.push(b);
    }
    p = b.double();
  }
  return points;
};
var Gpows = void 0;
var ctneg = (cnd, p) => {
  const n = p.negate();
  return cnd ? n : p;
};
var wNAF = (n) => {
  const comp = Gpows || (Gpows = precompute());
  let p = I;
  let f = G;
  for (let w = 0; w < 33; w++) {
    let wbits = Number(n & 255n);
    n >>= 8n;
    if (wbits > 128) {
      wbits -= 256;
      n += 1n;
    }
    const off = w * 128;
    const offP = off + Math.abs(wbits) - 1;
    const isOddW = w % 2 !== 0;
    const isNeg = wbits < 0;
    if (wbits === 0) {
      f = f.add(ctneg(isOddW, comp[off]));
    } else {
      p = p.add(ctneg(isNeg, comp[offP]));
    }
  }
  if (n !== 0n)
    throw new Error("invalid wnaf");
  return { p, f };
};

// lib/license-core/src/index.ts
var LICENSE_FORMAT = "dme-license";
var LICENSE_VERSION = 1;
var LICENSE_PUBLIC_KEY_SPKI_BASE64 = "MCowBQYDK2VwAyEA/iZ+q9UqglUUy+KOzzN0bNZUGMd1p7IwS0hCOF0QR1g=";
function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
function canonicalJson(value) {
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
    version: value.version
  });
}
function isPayload(value) {
  if (!value || typeof value !== "object") return false;
  const candidate = value;
  return candidate.format === LICENSE_FORMAT && candidate.version === LICENSE_VERSION && candidate.product === "damascus-emergency-inventory" && (candidate.platform === "android" || candidate.platform === "windows") && typeof candidate.keyId === "string" && typeof candidate.deviceId === "string" && typeof candidate.licenseId === "string" && typeof candidate.issuedAt === "string" && (candidate.expiresAt === null || typeof candidate.expiresAt === "string") && typeof candidate.appVersion === "string" && Array.isArray(candidate.features) && candidate.features.every((feature) => typeof feature === "string");
}
function encodeLicense(value) {
  return `${btoa(canonicalJson(value.payload))}.${value.signature}`;
}
hashes.sha512Async = async (message) => new Uint8Array(await crypto.subtle.digest("SHA-512", message));
async function verifyEd25519Fallback(signatureB64, canonical, publicKeySpkiB64) {
  try {
    const spki = base64ToBytes(publicKeySpkiB64);
    const rawKey = spki.slice(spki.length - 32);
    const sig = base64ToBytes(signatureB64);
    if (sig.length !== 64) return false;
    return await verifyAsync(sig, new TextEncoder().encode(canonical), rawKey);
  } catch {
    return null;
  }
}
function decodeLicense(value) {
  try {
    const [payloadEncoded, signature] = value.trim().split(".");
    if (!payloadEncoded || !signature) return null;
    const payload = JSON.parse(atob(payloadEncoded));
    if (!isPayload(payload) || !/^[A-Za-z0-9+/=]+$/.test(signature)) return null;
    return { payload, signature };
  } catch {
    return null;
  }
}
async function importPublicKey(publicKeySpkiBase64) {
  return crypto.subtle.importKey(
    "spki",
    base64ToBytes(publicKeySpkiBase64 ?? LICENSE_PUBLIC_KEY_SPKI_BASE64),
    { name: "Ed25519" },
    false,
    ["verify"]
  );
}
async function verifyLicense(encoded, expected) {
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
    const valid = await crypto.subtle.verify(
      { name: "Ed25519" },
      await importPublicKey(expected.publicKeySpkiBase64),
      base64ToBytes(signature),
      canonical
    );
    return valid ? { status: "valid", license: payload } : { status: "invalid" };
  } catch {
    const fallback = await verifyEd25519Fallback(
      signature,
      canonicalJson(payload),
      expected.publicKeySpkiBase64 ?? LICENSE_PUBLIC_KEY_SPKI_BASE64
    );
    if (fallback === true) return { status: "valid", license: payload };
    if (fallback === false) return { status: "invalid" };
    return { status: "unsupported" };
  }
}
function getInstallDeviceId(storage, storageKey) {
  const existing = storage.getItem(storageKey);
  if (existing) return existing;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = bytes[6] & 15 | 64;
  bytes[8] = bytes[8] & 63 | 128;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const id = `DME-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`.toUpperCase();
  storage.setItem(storageKey, id);
  return id;
}
function formatLicenseError(status) {
  switch (status) {
    case "missing":
      return "\u0644\u0627 \u064A\u0648\u062C\u062F \u062A\u0631\u062E\u064A\u0635 \u0644\u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632.";
    case "invalid":
      return "\u0645\u0644\u0641 \u0627\u0644\u062A\u0631\u062E\u064A\u0635 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D \u0623\u0648 \u062A\u0645 \u0627\u0644\u0639\u0628\u062B \u0628\u0647.";
    case "expired":
      return "\u0627\u0646\u062A\u0647\u062A \u0635\u0644\u0627\u062D\u064A\u0629 \u0627\u0644\u062A\u0631\u062E\u064A\u0635.";
    case "device-mismatch":
      return "\u0627\u0644\u062A\u0631\u062E\u064A\u0635 \u0635\u0627\u062F\u0631 \u0644\u062C\u0647\u0627\u0632 \u0622\u062E\u0631.";
    case "platform-mismatch":
      return "\u0627\u0644\u062A\u0631\u062E\u064A\u0635 \u0635\u0627\u062F\u0631 \u0644\u0645\u0646\u0635\u0629 \u0623\u062E\u0631\u0649.";
    case "unsupported":
      return "\u0627\u0644\u062A\u0631\u062E\u064A\u0635 \u063A\u064A\u0631 \u0645\u062A\u0648\u0627\u0641\u0642 \u0645\u0639 \u0625\u0635\u062F\u0627\u0631 \u0627\u0644\u062A\u0637\u0628\u064A\u0642.";
    case "version-mismatch":
      return "\u0625\u0635\u062F\u0627\u0631 \u0627\u0644\u062A\u0631\u062E\u064A\u0635 \u0644\u0627 \u064A\u0637\u0627\u0628\u0642 \u0625\u0635\u062F\u0627\u0631 \u0627\u0644\u062A\u0637\u0628\u064A\u0642. \u0623\u0639\u062F \u0625\u0635\u062F\u0627\u0631 \u0627\u0644\u062A\u0631\u062E\u064A\u0635.";
    default:
      return "";
  }
}
export {
  LICENSE_FORMAT,
  LICENSE_PUBLIC_KEY_SPKI_BASE64,
  LICENSE_VERSION,
  decodeLicense,
  encodeLicense,
  formatLicenseError,
  getInstallDeviceId,
  verifyLicense
};
/*! Bundled license information:

@noble/ed25519/index.js:
  (*! noble-ed25519 - MIT License (c) 2019 Paul Miller (paulmillr.com) *)
*/
