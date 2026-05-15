#!/bin/sh
# ============================================================================
# Gera /data/master.key (32 bytes aleatórios em base64) na primeira execução.
# Idempotente: se já existe, não toca. chmod 0400 pra blindar.
# ============================================================================
set -eu

KEY_PATH="${KEY_PATH:-/data/master.key}"

if [ -f "$KEY_PATH" ]; then
  echo "[master-key-init] já existe em $KEY_PATH — nada a fazer"
  exit 0
fi

# Garante /data existe
mkdir -p "$(dirname "$KEY_PATH")"

# Gera 32 bytes aleatórios e codifica em base64 (sem newline)
# Alpine tem /dev/urandom e busybox base64
head -c 32 /dev/urandom | base64 -w 0 > "$KEY_PATH"
chmod 0400 "$KEY_PATH"

echo "[master-key-init] gerada em $KEY_PATH ($(wc -c < "$KEY_PATH") bytes)"
