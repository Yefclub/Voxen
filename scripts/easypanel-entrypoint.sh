#!/usr/bin/env bash
set -euo pipefail

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "[easypanel] FATAL: $name não definido" >&2
    exit 1
  fi
}

require_env APP_BASE_URL
require_env DATABASE_URL
require_env REDIS_URL
require_env BETTER_AUTH_SECRET
require_env MASTER_KEY
require_env S3_ENDPOINT
require_env S3_ACCESS_KEY
require_env S3_SECRET_KEY
require_env S3_BUCKET

python - <<'PY'
import base64
import os
import sys

try:
    key = base64.b64decode(os.environ["MASTER_KEY"].strip(), validate=True)
except Exception as exc:
    print(f"[easypanel] FATAL: MASTER_KEY inválida: {exc}", file=sys.stderr)
    sys.exit(1)

if len(key) != 32:
    print("[easypanel] FATAL: MASTER_KEY deve ser base64 de 32 bytes", file=sys.stderr)
    sys.exit(1)
PY

export NODE_ENV="${NODE_ENV:-production}"
export PORT="${PORT:-3000}"
export CHAT_SERVICE_URL="${CHAT_SERVICE_URL:-http://127.0.0.1:8001}"
export S3_REGION="${S3_REGION:-us-east-1}"
export S3_FORCE_PATH_STYLE="${S3_FORCE_PATH_STYLE:-true}"

echo "[easypanel] generating Prisma Client..."
prisma generate --schema=/app/prisma/schema.prisma

echo "[easypanel] applying migrations..."
prisma migrate deploy --schema=/app/prisma/schema.prisma

terminate() {
  trap - TERM INT
  echo "[easypanel] stopping services..."
  kill -TERM "$chat_pid" "$worker_pid" "$web_pid" 2>/dev/null || true
  wait "$chat_pid" "$worker_pid" "$web_pid" 2>/dev/null || true
}

trap terminate TERM INT

echo "[easypanel] starting chat on 127.0.0.1:8001..."
(
  cd /app/apps/chat
  exec .venv/bin/uvicorn src.main:app --host 127.0.0.1 --port 8001
) &
chat_pid=$!

echo "[easypanel] starting worker..."
(
  cd /app/apps/worker
  exec .venv/bin/python -m src.main
) &
worker_pid=$!

echo "[easypanel] starting web on 0.0.0.0:${PORT}..."
(
  cd /app
  exec bun apps/web/src/index.ts
) &
web_pid=$!

set +e
wait -n "$chat_pid" "$worker_pid" "$web_pid"
status=$?
set -e

echo "[easypanel] a service exited with status $status"
terminate
exit "$status"
