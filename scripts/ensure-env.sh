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

if [ ! -f "$ENV_FILE" ]; then
  cp "$EXAMPLE_FILE" "$ENV_FILE"
  echo "[env] .env criado a partir de .env.example"
fi

append_if_missing "MASTER_KEY" "$(random_b64_32)"
append_if_missing "MINIO_ROOT_USER" "voxen"
append_if_missing "MINIO_ROOT_PASSWORD" "voxen_dev_minio_password"
append_if_missing "S3_ENDPOINT" "http://minio:9000"
append_if_missing "S3_ACCESS_KEY" "voxen"
append_if_missing "S3_SECRET_KEY" "voxen_dev_minio_password"
append_if_missing "S3_BUCKET" "voxen-transcripts"
append_if_missing "S3_REGION" "us-east-1"
append_if_missing "S3_FORCE_PATH_STYLE" "true"
# S3_PUBLIC_ENDPOINT (opcional): base URL do S3/MinIO alcançável pelo browser
# (ex.: https://s3.seudominio.com). Habilita upload direto via presigned URL.
# Sem default — se setado, requer CORS no bucket (ver docs/DEPLOY.md). Ausente =
# upload via app (fallback). Em dev local, o MinIO não tem TLS/CORS por padrão,
# então deixamos desabilitado.
