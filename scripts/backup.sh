#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backup_dir="${VOXEN_BACKUP_DIR:-$repo_root/backups}"
env_file="${VOXEN_ENV_FILE:-$repo_root/.env}"
backup_date="${VOXEN_BACKUP_DATE:-$(date +%Y-%m-%d_%H%M)}"

mkdir -p "$backup_dir"
umask 077

if [[ ! -f "$env_file" ]]; then
  echo "ERROR: environment file not found: $env_file" >&2
  exit 2
fi

driver="$(sed -n 's/^STORAGE_DRIVER=//p' "$env_file" | tail -1 | tr '[:upper:]' '[:lower:]')"
if [[ -z "$driver" ]]; then
  if grep -Eq '^(S3_|GARAGE_)[^=]*=.+$' "$env_file"; then driver=s3; else driver=local; fi
fi
if [[ "$driver" != local && "$driver" != s3 ]]; then
  echo "ERROR: STORAGE_DRIVER must be local or s3" >&2
  exit 2
fi
if [[ "$driver" == s3 ]] && ! docker volume inspect voxen_minio_data >/dev/null 2>&1; then
  echo "ERROR: external S3 is selected; configure and verify a provider backup first." >&2
  exit 2
fi

db_final="$backup_dir/db-$backup_date.sql.gz"
key_final="$backup_dir/master-key-$backup_date.env"
storage_final="$backup_dir/$([[ "$driver" == local ]] && echo storage || echo minio)-$backup_date.tar.gz"
db_raw="$(mktemp "$backup_dir/.db-$backup_date.XXXXXX.sql")"
db_temp="$(mktemp "$backup_dir/.db-$backup_date.XXXXXX.sql.gz")"
key_temp="$(mktemp "$backup_dir/.master-key-$backup_date.XXXXXX.env")"
storage_temp="$(mktemp "$backup_dir/.storage-$backup_date.XXXXXX.tar.gz")"
resume_services=()

cleanup() {
  local status=$?
  rm -f -- "$db_raw" "$db_temp" "$key_temp" "$storage_temp"
  if ((${#resume_services[@]})); then
    if ! docker compose start "${resume_services[@]}"; then
      echo "ERROR: backup finished but the previously running services could not be restarted" >&2
      ((status == 0)) && status=1
    fi
  fi
  trap - EXIT
  exit "$status"
}
trap cleanup EXIT

running_services="$(docker compose ps --status running --services)"
while IFS= read -r service; do
  case "$service" in
    web | worker) resume_services+=("$service") ;;
  esac
done <<<"$running_services"

if ((${#resume_services[@]})); then
  echo "→ Pausing application writers: ${resume_services[*]}"
  docker compose stop "${resume_services[@]}"
fi

postgres_user="$(sed -n 's/^POSTGRES_USER=//p' "$env_file" | tail -1)"
postgres_db="$(sed -n 's/^POSTGRES_DB=//p' "$env_file" | tail -1)"
postgres_user="${postgres_user:-voxen}"
postgres_db="${postgres_db:-voxen}"

echo "→ PostgreSQL → $db_final"
docker compose exec -T postgres pg_dump -U "$postgres_user" "$postgres_db" >"$db_raw"
gzip -c "$db_raw" >"$db_temp"

echo "→ Master key → $key_final"
grep '^MASTER_KEY=' "$env_file" >"$key_temp"

if [[ "$driver" == local ]]; then
  echo "→ Local storage → $storage_final"
  docker compose run --rm --no-deps --entrypoint tar web \
    czf - -C /data/storage . >"$storage_temp"
else
  echo "→ MinIO data → $storage_final"
  docker run --rm -v voxen_minio_data:/data:ro alpine \
    tar czf - -C /data . >"$storage_temp"
fi

mv -- "$db_temp" "$db_final"
mv -- "$key_temp" "$key_final"
mv -- "$storage_temp" "$storage_final"
chmod 0600 "$key_final"

echo
echo "✓ Backup complete in $backup_dir (timestamp $backup_date)"
ls -lh "$db_final" "$key_final" "$storage_final"
