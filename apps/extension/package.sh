#!/usr/bin/env bash
# Empacota a extensão MV3 em apps/web/public/extension/voxen-extension.zip
# para download pela UI do Voxen.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$ROOT/../.." && pwd)"
OUT_DIR="$REPO_ROOT/apps/web/public/extension"
OUT_ZIP="$OUT_DIR/voxen-extension.zip"
STAGE="$(mktemp -d)"

cleanup() {
  rm -rf "$STAGE"
}
trap cleanup EXIT

mkdir -p "$OUT_DIR"
rm -f "$OUT_ZIP"

# Copia só o runtime da extensão (sem package.sh, tests, README).
mkdir -p "$STAGE/voxen-extension"
cp "$ROOT/manifest.json" "$STAGE/voxen-extension/"
cp "$ROOT/background.js" "$STAGE/voxen-extension/"
cp "$ROOT/popup.html" "$ROOT/popup.js" "$ROOT/popup.css" "$STAGE/voxen-extension/"
cp "$ROOT/options.html" "$ROOT/options.js" "$ROOT/options.css" "$STAGE/voxen-extension/"
cp -R "$ROOT/lib" "$STAGE/voxen-extension/lib"
cp -R "$ROOT/icons" "$STAGE/voxen-extension/icons"

(
  cd "$STAGE"
  zip -r -q "$OUT_ZIP" voxen-extension
)

# Espelha o unpacked pra quem preferir "Load unpacked" apontando pra pasta servida
# em dev (opcional). Em prod o zip basta.
UNPACKED="$OUT_DIR/unpacked"
rm -rf "$UNPACKED"
cp -R "$STAGE/voxen-extension" "$UNPACKED"

echo "✓ Extensão empacotada: $OUT_ZIP ($(du -h "$OUT_ZIP" | awk '{print $1}'))"
echo "  Unpacked: $UNPACKED"
