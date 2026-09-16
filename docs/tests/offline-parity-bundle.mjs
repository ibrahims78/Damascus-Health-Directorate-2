#!/usr/bin/env node
/**
 * Bundles the on-device API (artifacts/web/src/lib/offline-api.ts) so the
 * parity test can exercise it in Node.
 *
 * Run:  node docs/tests/offline-parity-bundle.mjs
 */
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(root, "package.json"));

let esbuild;
try {
  esbuild = require("esbuild");
} catch {
  const store = path.join(root, "node_modules", ".pnpm");
  const dir = fs.readdirSync(store).find((name) => name.startsWith("esbuild@"));
  if (!dir) throw new Error("esbuild not found in node_modules/.pnpm");
  esbuild = require(path.join(store, dir, "node_modules", "esbuild", "lib", "main.js"));
}

const outDir = path.join(root, "docs", "tests", ".offline-parity");
fs.mkdirSync(outDir, { recursive: true });
const outfile = path.join(outDir, "offline-api.bundle.mjs");

await esbuild.build({
  entryPoints: [path.join(root, "artifacts", "web", "src", "lib", "offline-api.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile,
  define: {
    "import.meta.env": JSON.stringify({
      VITE_OFFLINE_MODE: "1",
      VITE_PROTECTED_BUILD: "0",
      VITE_APP_VERSION: "4.4.0",
    }),
  },
  logLevel: "warning",
});
console.log("bundled -> " + outfile);
