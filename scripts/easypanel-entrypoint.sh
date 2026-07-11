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
require_env S3_ENDPOINT
require_env S3_ACCESS_KEY
require_env S3_SECRET_KEY
require_env S3_BUCKET

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

wait_for_url_host "Postgres" "$DATABASE_URL" 5432
wait_for_url_host "Redis" "$REDIS_URL" 6379
wait_for_url_host "S3" "$S3_ENDPOINT" 9000
validate_s3_bucket

echo "[easypanel] generating Prisma Client..."
prisma generate --schema=/app/prisma/schema.prisma

echo "[easypanel] applying migrations..."
prisma migrate deploy --schema=/app/prisma/schema.prisma

# ---------------------------------------------------------------------------
# chisel — servidor de túnel reverso (opcional, dirigido por token).
# Aceita conexões do agente residencial na porta de controle (CHISEL_PORT,
# default 8088), que é exposta via domínio TLS no deploy. O SOCKS reverso
# (127.0.0.1:1080) NÃO é publicado — só o worker local o consome.
# O authfile é gerenciado em runtime pela app web (syncChiselAuthfile): começa
# vazio ({}, recusa qualquer conexão) e é preenchido quando o admin gera o token.
# O chisel faz hot-reload automático do authfile ao detectar mudança (sem sinal).
# Best-effort: se o chisel falhar, logamos e seguimos — o boot dos 3 serviços
# core NÃO depende dele.
# ---------------------------------------------------------------------------
export CHISEL_PORT="${CHISEL_PORT:-8088}"
export CHISEL_AUTHFILE="${CHISEL_AUTHFILE:-/run/voxen/chisel-auth.json}"
export CHISEL_PIDFILE="${CHISEL_PIDFILE:-/run/voxen/chisel.pid}"
export CHISEL_LOGFILE="${CHISEL_LOGFILE:-/run/voxen/chisel.log}"

start_chisel() {
  if ! command -v chisel >/dev/null 2>&1; then
    echo "[easypanel] chisel não instalado — túnel de proxy desabilitado"
    return 0
  fi
  mkdir -p \
    "$(dirname "$CHISEL_AUTHFILE")" \
    "$(dirname "$CHISEL_PIDFILE")" \
    "$(dirname "$CHISEL_LOGFILE")" 2>/dev/null || true
  # authfile inicial vazio: chisel falha se o arquivo não existir. {} = nega tudo
  # até o admin gerar o token. A app web reescreve o arquivo in-place e o chisel
  # faz hot-reload sozinho via fsnotify (NÃO usar SIGHUP — mata o chisel).
  if [[ ! -f "$CHISEL_AUTHFILE" ]]; then
    if echo '{}' > "$CHISEL_AUTHFILE"; then
      chmod 600 "$CHISEL_AUTHFILE" 2>/dev/null || true
    else
      echo "[easypanel] AVISO: não foi possível criar $CHISEL_AUTHFILE — túnel desabilitado"
      return 0
    fi
  fi
  echo "[easypanel] starting chisel server on 0.0.0.0:${CHISEL_PORT} (reverse)..."
  # A saída do chisel vai pro console E pra um arquivo de log (a app web lê as
  # últimas linhas pra detectar "address already in use" = 2º agente). Decidimos o
  # log-capture testando ANTES se o logfile é gravável: `if cmd & ; then` testaria
  # o status do *backgrounding* (sempre 0) — o teste de gravabilidade é a condição
  # REAL que escolhe o caminho. Truncar (`:>`) também limita o crescimento do log
  # por boot. Em ambos os ramos o job em background é o PRÓPRIO chisel, então `$!`
  # captura o PID do chisel (não o do tee) — preservando o terminate()/pidfile.
  if { : > "$CHISEL_LOGFILE"; } 2>/dev/null; then
    chmod 600 "$CHISEL_LOGFILE" 2>/dev/null || true
    chisel server \
      --reverse \
      --keepalive 25s \
      --authfile "$CHISEL_AUTHFILE" \
      --port "${CHISEL_PORT}" > >(tee -a "$CHISEL_LOGFILE" 2>/dev/null) 2>&1 &
  else
    echo "[easypanel] AVISO: $CHISEL_LOGFILE não gravável — chisel sem arquivo de log (detecção de conflito desabilitada)"
    chisel server \
      --reverse \
      --keepalive 25s \
      --authfile "$CHISEL_AUTHFILE" \
      --port "${CHISEL_PORT}" &
  fi
  echo $! > "$CHISEL_PIDFILE" 2>/dev/null || true
}

start_chisel || echo "[easypanel] AVISO: chisel server não iniciou (seguindo sem túnel)"

terminate() {
  trap - TERM INT
  echo "[easypanel] stopping services..."
  kill -TERM "$worker_pid" "$web_pid" 2>/dev/null || true
  if [[ -f "$CHISEL_PIDFILE" ]]; then
    kill -TERM "$(cat "$CHISEL_PIDFILE" 2>/dev/null)" 2>/dev/null || true
  fi
  wait "$worker_pid" "$web_pid" 2>/dev/null || true
}

trap terminate TERM INT

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
wait -n "$worker_pid" "$web_pid"
status=$?
set -e

echo "[easypanel] a service exited with status $status"
terminate
exit "$status"
