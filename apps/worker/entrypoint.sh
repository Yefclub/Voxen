#!/bin/sh
# ============================================================================
# Voxen worker entrypoint
# ============================================================================
# Compatibilidade legada: instalações antigas com Garage gravavam credenciais
# em /creds/voxen.env. Instalações novas usam S3_* direto no .env.
# ============================================================================
set -eu

CREDS="${GARAGE_CREDS_PATH:-/creds/voxen.env}"
if [ -r "$CREDS" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$CREDS"
  set +a
  echo "[worker] credenciais S3 legadas carregadas de $CREDS"
elif [ -z "${S3_ACCESS_KEY:-}" ] || [ -z "${S3_SECRET_KEY:-}" ]; then
  echo "[worker] WARN: S3_ACCESS_KEY/S3_SECRET_KEY não definidos" >&2
fi

exec "$@"
