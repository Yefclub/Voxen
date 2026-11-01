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

# Fail-fast em APP_BASE_URL malformado ANTES de subir qualquer serviço.
# Um valor como "https://" (esquema sem host) faz o better-auth crashar com
# "Invalid base URL", a web sai com status 1 e a stack entra em loop críptico.
# Exige esquema http/https E pelo menos um caractere de host após "://".
validate_app_base_url() {
  case "$APP_BASE_URL" in
    http://?* | https://?*)
      # Há algo após "://"; rejeitar se esse algo começa com "/" (host vazio,
      # ex.: "https:///path") — nesse caso o primeiro char após // é "/".
      local rest="${APP_BASE_URL#*://}"
      case "$rest" in
        /*)
          echo "[easypanel] ERRO: APP_BASE_URL inválido: '$APP_BASE_URL'. Precisa incluir o host, ex.: https://voxen.seudominio.com" >&2
          exit 1
          ;;
      esac
      ;;
    *)
      echo "[easypanel] ERRO: APP_BASE_URL inválido: '$APP_BASE_URL'. Precisa incluir o host, ex.: https://voxen.seudominio.com" >&2
      exit 1
      ;;
  esac
}

validate_app_base_url

require_env DATABASE_URL
require_env REDIS_URL
require_env BETTER_AUTH_SECRET
require_env MASTER_KEY

resolve_storage_driver() {
  if [[ -n "${STORAGE_DRIVER:-}" ]]; then
    case "${STORAGE_DRIVER,,}" in
      local | s3) STORAGE_DRIVER="${STORAGE_DRIVER,,}" ;;
      *) echo "[easypanel] FATAL: STORAGE_DRIVER deve ser local ou s3" >&2; exit 1 ;;
    esac
  elif env | grep -Eq '^(S3_|GARAGE_)[^=]*=.+$'; then
    STORAGE_DRIVER=s3
    echo "[easypanel] AVISO: configuração S3 legada detectada; defina STORAGE_DRIVER=s3 explicitamente"
  else
    STORAGE_DRIVER=local
  fi
  export STORAGE_DRIVER
}

validate_local_storage() {
  export STORAGE_LOCAL_PATH="${STORAGE_LOCAL_PATH:-/data/storage}"
  python - <<'PY'
import os
import pathlib
import tempfile

root = pathlib.Path(os.environ["STORAGE_LOCAL_PATH"])
if not root.is_absolute() or root == pathlib.Path(root.anchor):
    raise SystemExit("[easypanel] FATAL: STORAGE_LOCAL_PATH deve ser absoluto e não pode ser a raiz")
root.mkdir(parents=True, exist_ok=True, mode=0o750)
if root.is_symlink():
    raise SystemExit("[easypanel] FATAL: STORAGE_LOCAL_PATH não pode ser symlink")
root = root.resolve()
app_root = pathlib.Path("/app").resolve()
if root == app_root or app_root in root.parents:
    raise SystemExit("[easypanel] FATAL: STORAGE_LOCAL_PATH não pode ficar dentro de /app")

mount_points = []
try:
    for line in pathlib.Path("/proc/self/mountinfo").read_text(encoding="utf-8").splitlines():
        fields = line.split()
        if len(fields) >= 5:
            decoded = (
                fields[4]
                .replace(r"\040", " ")
                .replace(r"\011", "\t")
                .replace(r"\012", "\n")
                .replace(r"\134", "\\")
            )
            mount_points.append(pathlib.Path(decoded).resolve())
except OSError as exc:
    raise SystemExit(f"[easypanel] FATAL: não foi possível validar o volume persistente: {exc}") from exc

if not any(point != pathlib.Path("/") and (point == root or point in root.parents) for point in mount_points):
    raise SystemExit(
        f"[easypanel] FATAL: {root} está no filesystem efêmero do container; "
        "adicione um volume persistente nesse caminho"
    )
try:
    with tempfile.NamedTemporaryFile(prefix=".voxen-write-", dir=root, delete=True) as probe:
        probe.write(b"ok")
        probe.flush()
except OSError as exc:
    raise SystemExit(f"[easypanel] FATAL: volume local não gravável em {root}: {exc}") from exc
print(f"[easypanel] armazenamento local persistente pronto em {root}")
PY
}

resolve_storage_driver
if [[ "$STORAGE_DRIVER" = s3 ]]; then
  export S3_ENDPOINT="${S3_ENDPOINT:-${GARAGE_ENDPOINT:-}}"
  export S3_ACCESS_KEY="${S3_ACCESS_KEY:-${GARAGE_ACCESS_KEY:-}}"
  export S3_SECRET_KEY="${S3_SECRET_KEY:-${GARAGE_SECRET_KEY:-}}"
  export S3_BUCKET="${S3_BUCKET:-${GARAGE_BUCKET:-}}"
  require_env S3_ENDPOINT
  require_env S3_BUCKET
  creds_file="${S3_CREDS_PATH:-${GARAGE_CREDS_PATH:-/creds/voxen.env}}"
  if [[ -z "$S3_ACCESS_KEY" || -z "$S3_SECRET_KEY" ]] && [[ ! -r "$creds_file" ]]; then
    echo "[easypanel] FATAL: S3 credentials are incomplete and no readable credentials file exists" >&2
    exit 1
  fi
fi

wait_for_url_host() {
  local name="$1"
  local value="$2"
  local default_port="$3"
  local host_port

  host_port="$(
    TARGET_URL="$value" DEFAULT_PORT="$default_port" python - <<'PY'
import os
from urllib.parse import urlparse

url = os.environ["TARGET_URL"]
default_port = int(os.environ["DEFAULT_PORT"])
parsed = urlparse(url if "://" in url else f"//{url}")
host = parsed.hostname
if not host:
    raise SystemExit(1)
port = parsed.port
if port is None:
    if parsed.scheme == "http":
        port = 80
    elif parsed.scheme == "https":
        port = 443
    else:
        port = default_port
print(f"{host}:{port}")
PY
  )"

  local host="${host_port%:*}"
  local port="${host_port##*:}"
  echo "[easypanel] aguardando $name em $host:$port..."
  TARGET_HOST="$host" TARGET_PORT="$port" TARGET_NAME="$name" python - <<'PY'
import os
import socket
import sys
import time

host = os.environ["TARGET_HOST"]
port = int(os.environ["TARGET_PORT"])
name = os.environ["TARGET_NAME"]

max_attempts = 30

for attempt in range(1, max_attempts + 1):
    try:
        with socket.create_connection((host, port), timeout=2):
            print(f"[easypanel] {name} pronto (tentativa {attempt}/{max_attempts})")
            sys.exit(0)
    except OSError as exc:
        if attempt == 1 or attempt % 5 == 0 or attempt == max_attempts:
            print(
                f"[easypanel] {name} ainda indisponível "
                f"(tentativa {attempt}/{max_attempts}): {exc}"
            )
        time.sleep(2)

print(f"[easypanel] FATAL: {name} indisponível em {host}:{port}", file=sys.stderr)
sys.exit(1)
PY
}

validate_s3_bucket() {
  echo "[easypanel] validando bucket S3 ${S3_BUCKET}..."
  bun --cwd /app/apps/web - <<'JS'
import { HeadBucketCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { s3Bucket, s3Client } from "./src/lib/s3.ts";

const bucket = s3Bucket();
const key = ".voxen/healthcheck";

try {
  const client = s3Client();
  await client.send(new HeadBucketCommand({ Bucket: bucket }));
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: `ok ${new Date().toISOString()}\n`,
      ContentType: "text/plain; charset=utf-8",
    }),
  );
  console.log(`[easypanel] S3 bucket pronto: ${bucket}`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : "Error";
  console.error(`[easypanel] FATAL: S3 bucket ${bucket} indisponível ou sem escrita`);
  console.error(`[easypanel] S3 erro: ${name}: ${message}`);
  console.error(
    "[easypanel] Revise S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY e S3_FORCE_PATH_STYLE.",
  );
  process.exit(1);
}
JS
}

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
export S3_REGION="${S3_REGION:-us-east-1}"
export S3_FORCE_PATH_STYLE="${S3_FORCE_PATH_STYLE:-true}"

if [[ "$STORAGE_DRIVER" = local ]]; then
  validate_local_storage
fi
wait_for_url_host "Postgres" "$DATABASE_URL" 5432
wait_for_url_host "Redis" "$REDIS_URL" 6379
if [[ "$STORAGE_DRIVER" = s3 ]]; then
  wait_for_url_host "S3" "$S3_ENDPOINT" 9000
  validate_s3_bucket
fi

echo "[easypanel] generating Prisma Client..."
prisma generate --schema=/app/prisma/schema.prisma

echo "[easypanel] applying migrations..."
/prisma-migrate-deploy.sh /app/prisma/schema.prisma


terminate() {
  trap - TERM INT
  echo "[easypanel] stopping services..."
  kill -TERM "$web_pid" 2>/dev/null || true
  wait "$web_pid" 2>/dev/null || true
}

trap terminate TERM INT

echo "[easypanel] starting web on 0.0.0.0:${PORT}..."
(
  cd /app
  exec bun apps/web/src/index.ts
) &
web_pid=$!

set +e
wait "$web_pid"
status=$?
set -e

echo "[easypanel] a service exited with status $status"
terminate
exit "$status"
