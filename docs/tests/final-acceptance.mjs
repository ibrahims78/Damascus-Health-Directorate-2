#!/usr/bin/env node
/**
 * Final acceptance sweep: verifies every shipped artifact against the recorded
 * checksums and prints the deliverables inventory.
 *
 * Run:  node docs/tests/final-acceptance.mjs
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const del = path.join(root, "deliverables");
const sumsFile = path.join(del, "RELEASE-SHA256SUMS-4.4.0.txt");

if (!fs.existsSync(sumsFile)) {
  console.error("checksum file not found: " + sumsFile);
  process.exit(1);
}

const expected = new Map();
for (const line of fs.readFileSync(sumsFile, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-F0-9]{64})\s+(.+?)\s+\(/);
  if (m) expected.set(m[2], m[1]);
}
console.log(`checksums recorded: ${expected.size}`);

let ok = 0;
let bad = 0;
for (const [name, hash] of expected) {
  const candidates = [
    path.join(del, name),
    path.join(del, "Damascus-Health-Directorate-4.4.0-Android", name),
  ];
  const file = candidates.find((p) => fs.existsSync(p));
  if (!file) { console.log(`MISSING  ${name}`); bad += 1; continue; }
  const actual = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").toUpperCase();
  if (actual === hash) { ok += 1; console.log(`OK       ${name}`); }
  else { bad += 1; console.log(`MISMATCH ${name}\n  expected ${hash}\n  actual   ${actual}`); }
}

console.log(`\nchecksum verification: ${ok}/${expected.size} match, ${bad} problem(s)`);
console.log("\n=== deliverables inventory ===");
for (const entry of fs.readdirSync(del, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
  const p = path.join(del, entry.name);
  const size = entry.isDirectory()
    ? fs.readdirSync(p, { recursive: true }).length + " files"
    : (fs.statSync(p).size / 1048576).toFixed(1) + " MB";
  console.log(`  ${entry.isDirectory() ? "[dir] " : "      "}${entry.name.padEnd(52)} ${size}`);
}

// data folders must never be shipped inside a Windows package
console.log("\n=== package hygiene ===");
for (const name of ["Damascus-Health-Directorate-4.4.0-Portable-Windows-x64", "Damascus-Health-Directorate-4.4.0-Protected-Windows-x64"]) {
  const dir = path.join(del, name);
  if (!fs.existsSync(dir)) { console.log(`  ${name}: (absent)`); continue; }
  const dataDir = fs.existsSync(path.join(dir, "data"));
  const exes = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".exe"));
  const asar = fs.existsSync(path.join(dir, "resources", "app.asar"));
  if (dataDir) { bad += 1; console.log(`  ${name}: DATA FOLDER PRESENT (must be removed)`); }
  console.log(`  ${name}: launcher=${exes.join(",") || "none"} app.asar=${asar} data=${dataDir}`);
}

process.exit(bad ? 1 : 0);
