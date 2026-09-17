#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = packageJson.version;
const candidates = [
  "artifacts/api-server/dist/index.mjs",
  "artifacts/web/dist/index.html",
  "artifacts/web/dist/public/index.html",
];
const artifacts = [];
for (const relative of candidates) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) continue;
  const bytes = fs.readFileSync(file);
  artifacts.push({
    path: relative,
    bytes: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  });
}
if (!artifacts.length) {
  throw new Error("No build outputs found. Run pnpm build before release:dry-run.");
}

const manifest = {
  version,
  commit: process.env.GITHUB_SHA ?? "local",
  branch: process.env.GITHUB_REF_NAME ?? "local",
  generatedAt: new Date().toISOString(),
  artifacts,
};
console.log(JSON.stringify(manifest, null, 2));