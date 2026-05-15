#!/bin/sh
# ============================================================================
# Bootstrap idempotente do Garage:
#   1. Aguarda cluster ficar pronto
#   2. Configura layout (1 nó, zona dc1, 1G de capacidade)
#   3. Cria bucket
#   4. Cria key
#   5. Concede permissão da key no bucket
#   6. Escreve credenciais em /creds/voxen.env (consumido por web/worker/chat)
# ============================================================================
set -eu

BUCKET="${GARAGE_BUCKET:-voxen-transcripts}"
KEY_NAME="voxen-key"
CREDS_FILE="/creds/voxen.env"

# Já configurado? sai cedo
if [ -f "$CREDS_FILE" ]; then
  echo "[garage-init] $CREDS_FILE já existe — pulando bootstrap"
  exit 0
fi

# Pega node id do garage local
echo "[garage-init] aguardando garage subir..."
for i in $(seq 1 30); do
  NODE_ID=$(/garage status 2>/dev/null | awk '/^[0-9a-f]+/ {print $1; exit}') || true
  if [ -n "${NODE_ID:-}" ]; then break; fi
  sleep 2
done

if [ -z "${NODE_ID:-}" ]; then
  echo "[garage-init] ERRO: não consegui detectar node id do garage" >&2
  exit 1
fi
echo "[garage-init] node id: $NODE_ID"

# Layout
/garage layout assign -z dc1 -c 1G "$NODE_ID" || true
/garage layout apply --version 1 || true

# Bucket
if ! /garage bucket info "$BUCKET" >/dev/null 2>&1; then
  /garage bucket create "$BUCKET"
fi

# Key
if ! /garage key info --search "$KEY_NAME" >/dev/null 2>&1; then
  /garage key create "$KEY_NAME"
fi

# Permissões
/garage bucket allow --read --write --owner "$BUCKET" --key "$KEY_NAME"

# Exporta credenciais
KEY_INFO=$(/garage key info --show-secret "$KEY_NAME")
ACCESS=$(echo "$KEY_INFO" | awk -F': ' '/Key ID/ {print $2}' | tr -d ' \r')
SECRET=$(echo "$KEY_INFO" | awk -F': ' '/Secret key/ {print $2}' | tr -d ' \r')

mkdir -p /creds
cat > "$CREDS_FILE" <<EOF
GARAGE_ACCESS_KEY=$ACCESS
GARAGE_SECRET_KEY=$SECRET
GARAGE_BUCKET=$BUCKET
EOF
chmod 0400 "$CREDS_FILE"

echo "[garage-init] OK — bucket=$BUCKET key=$KEY_NAME creds=$CREDS_FILE"
