#!/usr/bin/env node
/**
 * Encoding guard: no source file may contain mojibake (UTF-8 Arabic that was
 * decoded as CP1252). Run it after any tool that rewrites source files.
 *
 * Run:  node docs/tests/encoding-check.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const roots = [
  path.join(root, "artifacts", "web", "src"),
  path.join(root, "artifacts", "api-server", "src"),
  path.join(root, "lib", "db", "src"),
  path.join(root, "scripts"),
];

const files = [];
const walk = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (/\.(ts|tsx|mjs|cjs|sql|json)$/.test(entry.name)) files.push(p);
  }
};
for (const dir of roots) walk(dir);

const offenders = [];
for (const file of files) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    // the mojibake marker: a UTF-8 Arabic lead byte rendered as a Latin-1 character
    if (/[ØÙ][\u0080-\u00BF\u2018-\u201D\u02C6-\u203A]/.test(line) || /Ø§|Ù„|Ø³|Ø¨|Ø©/.test(line)) {
      offenders.push(`${file.replace(root + path.sep, "")}:${index + 1}  ${line.trim().slice(0, 80)}`);
    }
  });
}

console.log(`checked ${files.length} source files for encoding damage`);
if (offenders.length === 0) {
  console.log("encoding: OK - no mojibake found");
  process.exit(0);
}
console.log(`encoding: ${offenders.length} line(s) with mojibake:`);
for (const item of offenders.slice(0, 40)) console.log("  " + item);
process.exit(1);
