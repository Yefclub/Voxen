#!/bin/sh
# ============================================================================
# Bootstrap idempotente do Garage via Admin API HTTP.
# Roda em alpine (imagem do garage v1.0.1 é distroless — sem /bin/sh).
#
#   1. Aguarda admin API responder
#   2. Aplica layout do nó local (1 nó, dc1, capacity 1G)
#   3. Cria bucket
#   4. Cria key
#   5. Concede permissão da key no bucket
#   6. Grava credenciais em /creds/voxen.env
# ============================================================================
set -eu

BUCKET="${GARAGE_BUCKET:-voxen-transcripts}"
KEY_NAME="voxen-key"
CREDS_FILE="/creds/voxen.env"
ADMIN_URL="${GARAGE_ADMIN_URL:-http://garage:3903}"
TOKEN="${GARAGE_ADMIN_TOKEN:?GARAGE_ADMIN_TOKEN não definido}"

if [ -f "$CREDS_FILE" ]; then
  echo "[garage-init] $CREDS_FILE já existe — pulando bootstrap"
  exit 0
fi

apk add --no-cache curl jq >/dev/null

api() {
  method="$1"; path="$2"; data="${3:-}"
  if [ -n "$data" ]; then
    curl -sS -X "$method" -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" -d "$data" "$ADMIN_URL$path"
  else
    curl -sS -X "$method" -H "Authorization: Bearer $TOKEN" "$ADMIN_URL$path"
  fi
}

echo "[garage-init] aguardando admin API em $ADMIN_URL..."
for i in $(seq 1 30); do
  code=$(curl -sS -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $TOKEN" "$ADMIN_URL/v1/health" 2>/dev/null || echo "000")
  if [ "$code" = "200" ]; then break; fi
  sleep 2
done

# Layout: pega node_id atual via /v1/status
STATUS=$(api GET /v1/status)
NODE_ID=$(echo "$STATUS" | jq -r '.node')
if [ -z "$NODE_ID" ] || [ "$NODE_ID" = "null" ]; then
  echo "[garage-init] ERRO: não consegui pegar node_id do /v1/status" >&2
  echo "$STATUS" >&2
  exit 1
fi
echo "[garage-init] node id: $NODE_ID"

# Atribui role ao nó
LAYOUT_BODY=$(printf '[{"id":"%s","zone":"dc1","capacity":1000000000,"tags":[]}]' "$NODE_ID")
api POST /v1/layout "$LAYOUT_BODY" >/dev/null || true

# Aplica próxima versão do layout
VERSION_NUM=$(api GET /v1/layout | jq -r '.version // 0')
NEXT=$((VERSION_NUM + 1))
api POST /v1/layout/apply "{\"version\":$NEXT}" >/dev/null || true
echo "[garage-init] layout aplicado (version=$NEXT)"

# Bucket (idempotente)
EXISTING_BUCKET=$(api GET "/v1/bucket?globalAlias=$BUCKET" | jq -r '.id // empty')
if [ -z "$EXISTING_BUCKET" ]; then
  BUCKET_ID=$(api POST /v1/bucket "{\"globalAlias\":\"$BUCKET\"}" | jq -r '.id')
  echo "[garage-init] bucket criado: $BUCKET ($BUCKET_ID)"
else
  BUCKET_ID="$EXISTING_BUCKET"
  echo "[garage-init] bucket já existe: $BUCKET ($BUCKET_ID)"
fi

# Key (idempotente)
KEY_LIST=$(api GET /v1/key)
KEY_ID=$(echo "$KEY_LIST" | jq -r ".[] | select(.name == \"$KEY_NAME\") | .id" 2>/dev/null | head -n1)
if [ -z "$KEY_ID" ] || [ "$KEY_ID" = "null" ]; then
  KEY_CREATE=$(api POST /v1/key "{\"name\":\"$KEY_NAME\"}")
  KEY_ID=$(echo "$KEY_CREATE" | jq -r '.accessKeyId')
  echo "[garage-init] key criada: $KEY_NAME ($KEY_ID)"
else
  echo "[garage-init] key já existe: $KEY_NAME ($KEY_ID)"
fi

# Permissões
api POST /v1/bucket/allow \
  "{\"bucketId\":\"$BUCKET_ID\",\"accessKeyId\":\"$KEY_ID\",\"permissions\":{\"read\":true,\"write\":true,\"owner\":true}}" \
  >/dev/null || true

# Pega secret e grava creds
KEY_INFO=$(api GET "/v1/key?id=$KEY_ID&showSecretKey=true")
ACCESS=$(echo "$KEY_INFO" | jq -r '.accessKeyId')
SECRET=$(echo "$KEY_INFO" | jq -r '.secretAccessKey')

if [ -z "$ACCESS" ] || [ -z "$SECRET" ] || [ "$SECRET" = "null" ]; then
  echo "[garage-init] ERRO: não consegui pegar access/secret" >&2
  echo "$KEY_INFO" >&2
  exit 1
fi

mkdir -p /creds
cat > "$CREDS_FILE" <<EOF
GARAGE_ACCESS_KEY=$ACCESS
GARAGE_SECRET_KEY=$SECRET
GARAGE_BUCKET=$BUCKET
EOF
chmod 0444 "$CREDS_FILE"

echo "[garage-init] OK — bucket=$BUCKET key=$KEY_NAME creds=$CREDS_FILE"
