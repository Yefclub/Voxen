#!/bin/sh
# ============================================================================
# Aplica CORS no bucket MinIO/S3 para permitir upload presigned direto do
# browser (PUT) + validação (HEAD).
# ============================================================================
# Necessário apenas quando S3_PUBLIC_ENDPOINT está configurado (upload direto).
# Sem CORS, o navegador bloqueia o PUT presigned por política de origem cruzada.
#
# Uso (a partir da raiz do projeto, com .env preenchido):
#   APP_ORIGIN=https://app.seudominio.com sh scripts/minio-cors.sh
#
# APP_ORIGIN deve ser a origin (scheme://host[:port]) onde o Voxen é servido.
# Para múltiplas origins, separe por vírgula em APP_ORIGIN.
#
# Requer: docker + imagem minio/mc. Idempotente (sobrescreve a regra de CORS).
# ============================================================================
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

# Carrega .env se existir (para credenciais do MinIO e bucket).
if [ -f "$ROOT_DIR/.env" ]; then
  # shellcheck disable=SC1091
  set -a
  . "$ROOT_DIR/.env"
  set +a
fi

S3_BUCKET="${S3_BUCKET:-voxen-transcripts}"
MINIO_ROOT_USER="${MINIO_ROOT_USER:-${S3_ACCESS_KEY:-voxen}}"
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-${S3_SECRET_KEY:-voxen_dev_minio_password}}"
# Endpoint interno do MinIO na rede Docker (não o público).
MINIO_INTERNAL="${MINIO_INTERNAL:-http://minio:9000}"

if [ -z "${APP_ORIGIN:-}" ]; then
  echo "ERRO: defina APP_ORIGIN com a origin do app (ex.: https://app.seudominio.com)" >&2
  exit 1
fi

# Monta o JSON de CORS. Uma rule por origin (separadas por vírgula em APP_ORIGIN).
RULES=""
OLD_IFS="$IFS"
IFS=','
for origin in $APP_ORIGIN; do
  origin="$(printf '%s' "$origin" | tr -d ' ')"
  [ -z "$origin" ] && continue
  rule=$(cat <<JSON
    {
      "AllowedOrigin": ["$origin"],
      "AllowedMethod": ["PUT", "HEAD", "GET"],
      "AllowedHeader": ["*"],
      "ExposeHeader": ["ETag"],
      "MaxAgeSeconds": 3000
    }
JSON
)
  if [ -z "$RULES" ]; then
    RULES="$rule"
  else
    RULES="$RULES,
$rule"
  fi
done
IFS="$OLD_IFS"

CORS_JSON=$(cat <<JSON
{
  "CORSRules": [
$RULES
  ]
}
JSON
)

echo "→ Aplicando CORS no bucket '$S3_BUCKET' (origins: $APP_ORIGIN)"

# Roda o mc num container efêmero na rede do compose.
docker run --rm \
  --network voxen_voxen-net \
  -e MC_HOST_voxen="http://${MINIO_ROOT_USER}:${MINIO_ROOT_PASSWORD}@${MINIO_INTERNAL#http://}" \
  --entrypoint /bin/sh \
  minio/mc:latest \
  -c "printf '%s' '$(printf '%s' "$CORS_JSON" | sed "s/'/'\\\\''/g")' > /tmp/cors.json && mc cors set voxen/${S3_BUCKET} /tmp/cors.json && mc cors get voxen/${S3_BUCKET}"

echo "✓ CORS aplicado. Teste um upload grande pela UI."
