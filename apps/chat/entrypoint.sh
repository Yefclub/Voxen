#!/bin/sh
set -eu

# Compatibilidade legada: instalações antigas com Garage gravavam credenciais
# em /creds/voxen.env. Instalações novas usam S3_* direto no .env.
CREDS="${GARAGE_CREDS_PATH:-/creds/voxen.env}"
if [ -r "$CREDS" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$CREDS"
  set +a
  echo "[chat] credenciais S3 legadas carregadas de $CREDS"
fi
exec "$@"
