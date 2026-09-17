#!/usr/bin/env node
/**
 * Keep active release display points derived from the root package version.
 *
 * Usage:
 *   node scripts/sync-version.mjs --check
 *   node scripts/sync-version.mjs --write
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const packageJsonPath = path.join(root, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const version = String(packageJson.version);
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
if (!match) throw new Error(`Root package version must be semver x.y.z, got ${version}`);

const [, major, minor, patch] = match;
const versionCode = Number(major) * 100 + Number(minor) * 10 + Number(patch);
if (!Number.isSafeInteger(versionCode) || versionCode <= 0) {
  throw new Error(`Could not derive a positive Android versionCode from ${version}`);
}

const replacements = [
  {
    file: "android/app/build.gradle",
    update(text) {
      return text
        .replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
        .replace(/versionName\s+"[^"]+"/, `versionName "${version}"`);
    },
  },
  {
    file: "artifacts/web/package.json",
    update(text) {
      return text.replace(/VITE_APP_VERSION=\d+\.\d+\.\d+/g, `VITE_APP_VERSION=${version}`);
    },
  },
  {
    file: "artifacts/web/src/components/layout/sidebar.tsx",
    update(text) {
      return text.replace(/VITE_APP_VERSION \?\? "v[^"]+"/, `VITE_APP_VERSION ?? "v${version}"`);
    },
  },
  {
    file: "artifacts/web/src/pages/help.tsx",
    update(text) {
      return text.replace(
        /VITE_APP_VERSION \?\? '[^']+'/,
        `VITE_APP_VERSION ?? '${version}'`,
      );
    },
  },
  {
    file: "scripts/issue-license.mjs",
    update(text) {
      return text.replace(/arg\("app-version"\) \?\? "[^"]+"/, `arg("app-version") ?? "${version}"`);
    },
  },
];

const changes = [];
for (const entry of replacements) {
  const filePath = path.join(root, entry.file);
  const before = fs.readFileSync(filePath, "utf8");
  const after = entry.update(before);
  if (before !== after) changes.push(entry.file);
  if (process.argv.includes("--write")) fs.writeFileSync(filePath, after);
}

if (process.argv.includes("--write")) {
  console.log(`version synced: ${version} (Android versionCode ${versionCode})`);
} else if (changes.length) {
  console.error(`version drift detected in: ${changes.join(", ")}`);
  console.error("Run: pnpm version:sync");
  process.exitCode = 1;
} else {
  console.log(`version check passed: ${version} (Android versionCode ${versionCode})`);
}