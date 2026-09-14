#!/usr/bin/env bash
# CI E2E runner: boots two fresh API instances (temp data dirs, seeded),
# runs the security and sync suites against them, then tears everything down.
set -euo pipefail

export DAMASCUS_DESKTOP=1
if [ -z "${SEED_ADMIN_PASSWORD-}" ]; then
  # Generate a local-only password for each isolated run. Never reuse it for
  # a deployed or shared environment.
  SEED_ADMIN_PASSWORD="$(node -e "process.stdout.write('LocalTest!2026-' + require('node:crypto').randomBytes(12).toString('base64url'))")"
fi
export SEED_ADMIN_PASSWORD
export DAMASCUS_SCHEMA_PATH="$PWD/lib/db/desktop-schema.sql"
API="node artifacts/api-server/dist/index.mjs"
PORT_A="${E2E_PORT_A:-8081}"
PORT_B="${E2E_PORT_B:-8082}"
FRESH_PORT="${E2E_FRESH_PORT:-8083}"
DATA_A="$(mktemp -d)"
DATA_B="$(mktemp -d)"

wait_health() {
  local port="$1"
  for _ in $(seq 1 30); do
    if curl -sf "http://127.0.0.1:${port}/api/healthz" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "instance on :${port} did not become healthy" >&2
  return 1
}

boot_seed_boot() {
  local port="$1"
  local data_dir="$2"
  DAMASCUS_DATA_DIR="$data_dir" PORT="$port" $API >/tmp/dme-api-boot.log 2>&1 &
  local pid=$!
  wait_health "$port"
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  (cd artifacts/api-server && DAMASCUS_DATA_DIR="$data_dir" node --enable-source-maps dist/seed.mjs >/tmp/dme-seed.log 2>&1) || (sleep 2 && cd artifacts/api-server && DAMASCUS_DATA_DIR="$data_dir" node --enable-source-maps dist/seed.mjs >>/tmp/dme-seed.log 2>&1)
  DAMASCUS_DATA_DIR="$data_dir" PORT="$port" $API >/tmp/dme-api.log 2>&1 &
}

(cd artifacts/api-server && node build-seed.mjs)

boot_seed_boot "$PORT_A" "$DATA_A"
PID_A=$!
boot_seed_boot "$PORT_B" "$DATA_B"
PID_B=$!

cleanup() {
  kill "$PID_A" "$PID_B" 2>/dev/null || true
  rm -rf "$DATA_A" "$DATA_B"
}
trap cleanup EXIT

wait_health "$PORT_A"
wait_health "$PORT_B"

export SYNC_A="http://127.0.0.1:${PORT_A}"
export SYNC_B="http://127.0.0.1:${PORT_B}"
export SECURITY_A="$SYNC_A"
export SECURITY_B="$SYNC_B"
export SECURITY_FRESH_PORT="$FRESH_PORT"
node docs/tests/api-sync-tests.mjs
node docs/tests/api-security-tests.mjs
node docs/tests/offline-password.test.mjs

echo "ALL SUITES PASSED"
