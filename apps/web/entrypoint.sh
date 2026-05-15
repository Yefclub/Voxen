#!/bin/sh
set -eu

# Aplica migrations pendentes — falha o boot se der erro
echo "[web] aplicando migrations Prisma..."
prisma migrate deploy --schema=/app/prisma/schema.prisma

# Sobe app
echo "[web] iniciando..."
exec "$@"
