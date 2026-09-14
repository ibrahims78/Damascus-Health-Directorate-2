/**
 * Build and run the seed script.
 * Usage: node seed.mjs
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { execSync } from "node:child_process";

globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [path.resolve(artifactDir, "src/seed.ts")],
  platform: "node",
  bundle: true,
  format: "esm",
  outfile: path.resolve(artifactDir, "dist/seed.mjs"),
  tsconfig: path.resolve(artifactDir, "tsconfig.json"),
  banner: {
    js: `import { createRequire as __crReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';
globalThis.require = __crReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
`,
  },
  logLevel: "warning",
});

execSync(`node --enable-source-maps "${path.resolve(artifactDir, "dist/seed.mjs")}"`, {
  stdio: "inherit",
  cwd: artifactDir,
});
