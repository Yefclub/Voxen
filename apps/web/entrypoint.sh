#!/bin/sh
set -eu

SCHEMA=/app/prisma/schema.prisma

echo "[web] generating Prisma Client..."
prisma generate --schema="$SCHEMA"

echo "[web] applying migrations..."
prisma migrate deploy --schema="$SCHEMA"

echo "[web] starting..."
exec "$@"
