#!/bin/sh
set -eu
CREDS="${GARAGE_CREDS_PATH:-/creds/voxen.env}"
if [ -r "$CREDS" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$CREDS"
  set +a
  echo "[chat] garage creds carregadas de $CREDS"
fi
exec "$@"
