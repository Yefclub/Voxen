#!/bin/sh
# ============================================================================
# Voxen worker entrypoint
# ============================================================================
# Compatibilidade legada: instalações antigas com Garage gravavam credenciais
# em /creds/voxen.env. Instalações novas usam S3_* direto no .env.
# ============================================================================
set -eu

DRIVER="${STORAGE_DRIVER:-}"
if [ -z "$DRIVER" ]; then
  if env | grep -Eq '^(S3_|GARAGE_)[^=]*=.+$'; then
    DRIVER=s3
    echo "[worker] WARN: legacy S3 configuration detected; set STORAGE_DRIVER=s3 explicitly"
  else
    DRIVER=local
  fi
fi
export STORAGE_DRIVER="$DRIVER"
CREDS="${GARAGE_CREDS_PATH:-${S3_CREDS_PATH:-/creds/voxen.env}}"
if [ "$DRIVER" = s3 ] && [ -r "$CREDS" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$CREDS"
  set +a
  echo "[worker] legacy S3 credentials loaded from $CREDS"
fi

if [ "$DRIVER" = local ]; then
  STORAGE_LOCAL_PATH="${STORAGE_LOCAL_PATH:-/data/storage}"
  case "$STORAGE_LOCAL_PATH" in
    /*) ;;
    *) echo "[worker] FATAL: STORAGE_LOCAL_PATH must be absolute" >&2; exit 1 ;;
  esac
  if [ "$STORAGE_LOCAL_PATH" = / ] || [ -L "$STORAGE_LOCAL_PATH" ]; then
    echo "[worker] FATAL: unsafe local storage path: $STORAGE_LOCAL_PATH" >&2
    exit 1
  fi
  case "$STORAGE_LOCAL_PATH" in
    /app | /app/*) echo "[worker] FATAL: local storage cannot be inside /app" >&2; exit 1 ;;
  esac
  mkdir -p "$STORAGE_LOCAL_PATH"
  if [ ! -d "$STORAGE_LOCAL_PATH" ] || [ ! -w "$STORAGE_LOCAL_PATH" ]; then
    echo "[worker] FATAL: local storage is not writable: $STORAGE_LOCAL_PATH" >&2
    exit 1
  fi
  RESOLVED_STORAGE_PATH="$(realpath "$STORAGE_LOCAL_PATH")"
  case "$RESOLVED_STORAGE_PATH" in
    /app | /app/*) echo "[worker] FATAL: local storage cannot be inside /app" >&2; exit 1 ;;
  esac
  if ! awk -v target="$RESOLVED_STORAGE_PATH" '
    {
      mountpoint = $5
      gsub(/\\040/, " ", mountpoint)
      gsub(/\\011/, "\t", mountpoint)
      if (mountpoint != "/" && (target == mountpoint || index(target, mountpoint "/") == 1)) found = 1
    }
    END { exit(found ? 0 : 1) }
  ' /proc/self/mountinfo; then
    echo "[worker] FATAL: $RESOLVED_STORAGE_PATH is ephemeral; attach a persistent volume" >&2
    exit 1
  fi
  export STORAGE_LOCAL_PATH
else
  S3_ENDPOINT="${S3_ENDPOINT:-${GARAGE_ENDPOINT:-}}"
  S3_ACCESS_KEY="${S3_ACCESS_KEY:-${GARAGE_ACCESS_KEY:-}}"
  S3_SECRET_KEY="${S3_SECRET_KEY:-${GARAGE_SECRET_KEY:-}}"
  S3_BUCKET="${S3_BUCKET:-${GARAGE_BUCKET:-}}"
  if [ -z "$S3_ENDPOINT" ] || [ -z "$S3_BUCKET" ] || [ -z "$S3_ACCESS_KEY" ] || [ -z "$S3_SECRET_KEY" ]; then
    echo "[worker] FATAL: incomplete S3 configuration for STORAGE_DRIVER=s3" >&2
    exit 1
  fi
  export S3_ENDPOINT S3_ACCESS_KEY S3_SECRET_KEY S3_BUCKET
fi

exec "$@"
