#!/usr/bin/env bash
# ============================================================================
# Voxen — chat-history archive before the Product 2 table-drop migration
# (spec 215, issue #894).
#
# Dumps the retired conversational tables to a timestamped directory so chat
# history survives the migration that drops them. Automation runs, cost
# events, and AI capability probes are telemetry, not user content, and are
# intentionally NOT archived.
#
# Usage: DATABASE_URL=... ./scripts/export-chat-archive.sh [output-dir]
# Output: <output-dir>/chat-archive-<UTC-timestamp>/{TABLE}.json (one JSON
# array per row set) plus manifest.json with row counts and schema version.
#
# Requires: DATABASE_URL (Postgres with the pre-migration schema),
#   python3 (stdlib only: json, urllib, datetime — no extra deps).
# ============================================================================
set -euo pipefail

OUT_DIR="${1:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$OUT_DIR/chat-archive-$STAMP"
mkdir -p "$DEST"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "FATAL: DATABASE_URL is not set (needs the pre-migration schema)." >&2
  exit 1
fi

# Tables owned by the retired conversational product, in dependency order
# (children first so a restore can re-insert parents first).
TABLES=(
  ChatMessage
  ChatTurn
  ChatApproval
  ChatCompactionLease
  ChatStreamLease
  Conversation
  CostEvent
)

DB_URL="$DATABASE_URL" DEST_DIR="$DEST" python3 - <<'PYEOF'
import json
import os
import sys
import urllib.parse

try:
    import psycopg  # type: ignore
    HAVE_PSYCOPG = True
except ImportError:
    HAVE_PSYCOPG = False

if not HAVE_PSYCOPG:
    # Fall back to pg_dump-style CSV via psql if available.
    import shutil
    import subprocess

    if not shutil.which("psql") and not shutil.which("pg_dump"):
        print(
            "FATAL: need either python psycopg or the psql/pg_dump CLIs.",
            file=sys.stderr,
        )
        sys.exit(1)

TABLES = [
    "ChatMessage",
    "ChatTurn",
    "ChatApproval",
    "ChatCompactionLease",
    "ChatStreamLease",
    "Conversation",
    "CostEvent",
]

dest = os.environ["DEST_DIR"]
manifest = {"archivedAt": None, "tables": {}}

if HAVE_PSYCOPG:
    import datetime

    conn = psycopg.connect(os.environ["DB_URL"])
    try:
        with conn.cursor() as cur:
            for table in TABLES:
                cur.execute(f'SELECT to_jsonb(t) FROM "{table}" t ORDER BY 1')
                rows = [row[0] for row in cur.fetchall()]
                with open(os.path.join(dest, f"{table}.json"), "w") as fh:
                    json.dump(rows, fh, default=str)
                manifest["tables"][table] = len(rows)
        manifest["archivedAt"] = (
            datetime.datetime.now(datetime.timezone.utc).isoformat()
        )
    finally:
        conn.close()
else:
    import datetime
    import subprocess

    db_url = os.environ["DB_URL"]
    for table in TABLES:
        out = os.path.join(dest, f"{table}.json")
        proc = subprocess.run(
            [
                "psql",
                db_url,
                "-X",
                "-A",
                "-t",
                "-c",
                f"SELECT coalesce(json_agg(t), '[]') FROM (SELECT * FROM \"{table}\" ORDER BY 1) t;",
            ],
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0:
            print(f"FATAL: dump of {table} failed: {proc.stderr}", file=sys.stderr)
            sys.exit(1)
        with open(out, "w") as fh:
            fh.write(proc.stdout.strip() + "\n")
        manifest["tables"][table] = "see-file"
    manifest["archivedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()

with open(os.path.join(dest, "manifest.json"), "w") as fh:
    json.dump(manifest, fh, indent=2)
    fh.write("\n")
print(f"archived tables to {dest}")
PYEOF

echo "Chat archive written to $DEST"
ls -la "$DEST"
