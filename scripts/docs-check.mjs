#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const skipped = new Set(["scripts/docs-check.mjs", "scripts/security-scan.mjs"]);
const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: root })
  .toString()
  .split("\0")
  .filter(Boolean)
  .filter((file) => /\.(md|markdown)$/i.test(file));
const errors = [];

for (const file of files) {
  if (skipped.has(file)) continue;
  const text = fs.readFileSync(path.join(root, file), "utf8");
  if (text.includes("https://github.com/ibrahims78/Damascus-Health-Directorate/")) {
    errors.push(`${file}: old GitHub repository URL`);
  }
  if (/release-artifacts\/v4\.3\.0|(?:^|[`/ ])deliverables\//.test(text)) {
    errors.push(`${file}: obsolete release path`);
  }

  for (const [, target] of text.matchAll(/\]\(([^)]+)\)/g)) {
    if (/^(?:https?:|mailto:|#|data:)/i.test(target)) continue;
    const clean = target.split("#")[0].split("?")[0];
    if (!clean || clean.endsWith("/")) continue;
    const resolved = path.resolve(path.dirname(path.join(root, file)), clean);
    if (!fs.existsSync(resolved)) errors.push(`${file}: missing link target ${target}`);
  }
}

if (errors.length) {
  console.error("documentation/path check failed");
  for (const error of errors) console.error(error);
  process.exit(1);
}

console.log(`documentation/path check passed: ${files.length} Markdown files`);