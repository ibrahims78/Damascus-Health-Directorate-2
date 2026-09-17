#!/usr/bin/env node
/**
 * Lightweight repository security gate for current tracked files and Git
 * history. It intentionally checks high-confidence secret markers only.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const skippedScanners = new Set(["scripts/security-scan.mjs", "scripts/docs-check.mjs"]);
const tracked = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: root })
  .toString()
  .split("\0")
  .filter(Boolean);

const currentRules = [
  ["old repository URL", /github\.com\/ibrahims78\/Damascus-Health-Directorate(?:\/|[^-])/i],
  ["personal phone", /(?:00963933706403|0933706403)/],
  ["private key material", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ["GitHub token", /\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{20,}/],
];

const findings = [];
for (const file of tracked) {
  if (skippedScanners.has(file)) continue;
  const base = path.basename(file);
  if (/^\.env(?:$|\.local$|\.production$)/i.test(base)) {
    findings.push(`${file}: tracked environment file`);
    continue;
  }
  const fullPath = path.join(root, file);
  if (!fs.statSync(fullPath).isFile()) continue;
  const text = fs.readFileSync(fullPath);
  if (text.includes(0)) continue;
  const value = text.toString("utf8");
  for (const [name, rule] of currentRules) {
    if (rule.test(value)) findings.push(`${file}: ${name}`);
  }
}

const historyRules = [
  "-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----",
  "\\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}",
  "\\bAKIA[0-9A-Z]{16}\\b",
  "\\bxox[baprs]-[A-Za-z0-9-]{20,}",
];
const commits = execFileSync("git", ["rev-list", "--all"], { cwd: root })
  .toString()
  .trim()
  .split(/\s+/)
  .filter(Boolean);
const historyFindings = [];
for (const commit of commits) {
  for (const pattern of historyRules) {
    try {
      const result = execFileSync(
        "git",
        ["grep", "-I", "-n", "-E", pattern, commit, "--", ":!scripts/security-scan.mjs"],
        { cwd: root, stdio: ["ignore", "pipe", "ignore"] },
      ).toString().trim();
      if (result) historyFindings.push(`${commit.slice(0, 12)}: ${result}`);
    } catch {
      // git grep exits 1 when the pattern is absent.
    }
  }
}

if (findings.length || historyFindings.length) {
  console.error("security scan failed");
  for (const finding of findings) console.error(`current: ${finding}`);
  for (const finding of historyFindings) console.error(`history: ${finding}`);
  process.exit(1);
}

console.log(`security scan passed: ${tracked.length} tracked files, ${commits.length} commits checked`);