#!/bin/sh
# ============================================================================
# Voxen worker entrypoint
# ============================================================================
# Carrega credenciais do Garage de /creds/voxen.env (gerado pelo garage-init)
# como env vars antes de exec o processo principal. O arquivo é montado
# read-only via volume garage_creds.
# ============================================================================
set -eu

CREDS="${GARAGE_CREDS_PATH:-/creds/voxen.env}"
if [ -r "$CREDS" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$CREDS"
  set +a
  echo "[worker] garage creds carregadas de $CREDS"
else
  echo "[worker] WARN: $CREDS não legível — Garage upload pode falhar" >&2
fi

exec "$@"
