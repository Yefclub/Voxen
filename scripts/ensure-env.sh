#!/bin/sh
# ============================================================================
# Garante um .env local funcional sem sobrescrever secrets existentes.
# ============================================================================
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
EXAMPLE_FILE="$ROOT_DIR/.env.example"

random_b64_32() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32
  else
    head -c 32 /dev/urandom | base64 | tr -d '\n'
    printf '\n'
  fi
}

has_key() {
  grep -Eq "^$1=" "$ENV_FILE"
}

append_if_missing() {
  key="$1"
  value="$2"
  if ! has_key "$key"; then
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
    echo "[env] adicionada variável $key em .env"
  fi
}

env_existed=true
if [ ! -f "$ENV_FILE" ]; then
  env_existed=false
  cp "$EXAMPLE_FILE" "$ENV_FILE"
  echo "[env] .env criado a partir de .env.example"
fi

append_if_missing "MASTER_KEY" "$(random_b64_32)"
if ! has_key "STORAGE_DRIVER"; then
  if [ "$env_existed" = true ] && grep -Eq '^(S3_|GARAGE_)[^=]*=.+$' "$ENV_FILE"; then
    append_if_missing "STORAGE_DRIVER" "s3"
    echo "[env] instalação existente com configuração S3 preservada"
  else
    append_if_missing "STORAGE_DRIVER" "local"
    append_if_missing "STORAGE_LOCAL_PATH" "/data/storage"
  fi
fi
