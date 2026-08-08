#!/bin/sh
set -eu

schema="${1:-/app/prisma/schema.prisma}"
prisma_bin="${PRISMA_BIN:-prisma}"
failed_migration="20260808130000_saved_media_library"
repair_sql="${PRISMA_REPAIR_DIR:-/app/prisma/repairs}/${failed_migration}.sql"

set +e
deploy_output="$("$prisma_bin" migrate deploy --schema="$schema" 2>&1)"
deploy_status=$?
set -e
if [ "$deploy_status" -eq 0 ]; then
  printf '%s\n' "$deploy_output"
  exit 0
fi
printf '%s\n' "$deploy_output" >&2

case "$deploy_output" in
  *"Error: P3009"* | *"Error: P3018"*) ;;
  *) exit "$deploy_status" ;;
esac
case "$deploy_output" in
  *"$failed_migration"*) ;;
  *) exit "$deploy_status" ;;
esac

if [ ! -r "$repair_sql" ]; then
  echo "[migrate] FATAL: repair SQL not found for $failed_migration" >&2
  exit "$deploy_status"
fi

echo "[migrate] repairing the known partial migration $failed_migration..."
"$prisma_bin" db execute --file="$repair_sql" --schema="$schema"
"$prisma_bin" migrate resolve --applied "$failed_migration" --schema="$schema"

echo "[migrate] known migration repaired; resuming migrate deploy..."
"$prisma_bin" migrate deploy --schema="$schema"
