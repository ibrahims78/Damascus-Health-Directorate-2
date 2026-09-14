// Bundle the seed entry (build:seed) — the api build wipes dist, so CI and
// the e2e runner rebuild seed.mjs with this before seeding instances.
import { build } from "esbuild";

await build({
  entryPoints: ["src/seed.ts"],
  platform: "node",
  bundle: true,
  format: "esm",
  outfile: "dist/seed.mjs",
  tsconfig: "tsconfig.json",
  logLevel: "warning",
  banner: {
    js: "import { createRequire as __crReq } from 'node:module';\nglobalThis.require = __crReq(import.meta.url);",
  },
});
