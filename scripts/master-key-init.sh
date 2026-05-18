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
# 0444 (world-readable) porque web/worker/chat rodam como users non-root
# em containers separados. Containers já isolam o volume — a chave nunca
# sai do volume `master_key` montado read-only nos serviços que precisam.
chmod 0444 "$KEY_PATH"

echo "[master-key-init] gerada em $KEY_PATH ($(wc -c < "$KEY_PATH") bytes)"
