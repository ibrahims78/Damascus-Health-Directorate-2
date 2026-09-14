#!/bin/bash
set -euo pipefail

pnpm install --frozen-lockfile

if [[ "${POST_MERGE_RUN_DB_SETUP:-0}" == "1" ]]; then
  pnpm --filter @workspace/db run push
  pnpm --filter @workspace/api-server run seed
else
  echo "POST_MERGE_RUN_DB_SETUP is not enabled; skipping hosted PostgreSQL push and seed."
  echo "The desktop workflow initializes its local PGlite schema at application startup."
fi
