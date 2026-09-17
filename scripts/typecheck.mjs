import { spawnSync } from "node:child_process";

const checks = [
  [
    "library project references",
    ["exec", "tsc", "-b", "tsconfig.json", "--pretty", "false", "--force"],
  ],
  [
    "API server",
    ["--filter", "@workspace/api-server", "run", "typecheck"],
  ],
  ["web", ["--filter", "@workspace/web", "run", "typecheck"]],
  ["scripts", ["--filter", "@workspace/scripts", "run", "typecheck"]],
  ["backup format", ["--filter", "@workspace/backup-format", "run", "typecheck"]],
  ["sync contract", ["--filter", "@workspace/sync-contract", "run", "typecheck"]],
];

for (const [name, args] of checks) {
  console.log(`\n[typecheck] ${name}`);
  const result = spawnSync("pnpm", args, {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    console.error(`[typecheck] ${name} could not start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[typecheck] ${name} failed with exit code ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

console.log("\n[typecheck] all checks passed");