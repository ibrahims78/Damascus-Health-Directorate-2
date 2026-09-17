#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const assetRoot = path.join(root, "artifacts", "web", "dist", "public", "assets");
const maxKb = Number(process.env.BUNDLE_MAX_KB ?? 600);
const warnKb = Number(process.env.BUNDLE_WARN_KB ?? 500);

if (!Number.isFinite(maxKb) || !Number.isFinite(warnKb) || warnKb <= 0 || maxKb < warnKb) {
  throw new Error("BUNDLE_WARN_KB and BUNDLE_MAX_KB must be positive numbers with max >= warn");
}

function listAssets(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return listAssets(file);
    if (/\.(?:js|css)$/u.test(entry.name)) return [file];
    return [];
  });
}

const assets = listAssets(assetRoot);
if (assets.length === 0) {
  throw new Error(`No JavaScript or CSS build assets found under ${path.relative(root, assetRoot)}.`);
}

const results = assets
  .map((file) => ({
    path: path.relative(root, file),
    bytes: fs.statSync(file).size,
  }))
  .sort((a, b) => b.bytes - a.bytes);
const warnings = results.filter(({ bytes }) => bytes > warnKb * 1024);
const failures = results.filter(({ bytes }) => bytes > maxKb * 1024);

console.log(JSON.stringify({
  assetCount: results.length,
  warnLimitKb: warnKb,
  maxLimitKb: maxKb,
  largest: results.slice(0, 10).map((asset) => ({
    ...asset,
    kibibytes: Number((asset.bytes / 1024).toFixed(1)),
  })),
  warnings: warnings.map((asset) => asset.path),
  failures: failures.map((asset) => asset.path),
}, null, 2));

if (failures.length > 0) {
  throw new Error(`Bundle budget exceeded: ${failures.join(", ")}`);
}