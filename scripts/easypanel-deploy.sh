#!/bin/sh
# ============================================================================
# Dispara redeploy do serviço Voxen no Easypanel (self-hosted).
# ============================================================================
# MANUAL ONLY — auto-deploy desligado. Exige VOXEN_ALLOW_DEPLOY=1.
#
# Formato no painel Easypanel (igual Orbital): o log imprime o *subject do
# commit* que está no HEAD de `dev`. Por isso só implantamos quando o HEAD é
# um bump do version-dev:
#   set version to X.Y.Z-dev.<timestamp>
# Se implantar no squash de uma feature, o painel mostra o body inteiro da PR
# (#432, Co-authored-by, etc.) — isso NÃO é bug do Easypanel, é o texto do git.
#
# Fluxo correto (espelha Orbital: deploy DEPOIS do version-dev):
#   1. Feature mergeia em dev
#   2. version-dev abre/mergeia "set version to …"
#   3. Só então roda este script (ou Deploy no painel com HEAD limpo)
#
# Idempotente: marcador de SHA evita redeploy do mesmo commit.
# API key só via ambiente (EASYPANEL_API_KEY), nunca no repo.
#
# Uso:
#   export VOXEN_ALLOW_DEPLOY=1
#   set -a; source ~/.claude/voxen-easypanel.env.disabled; set +a
#   scripts/easypanel-deploy.sh [--dry-run]
#
# Escape de emergência (não recomendado): VOXEN_ALLOW_DIRTY_DEPLOY=1
# ============================================================================
set -eu

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
EASYPANEL_URL="${EASYPANEL_URL:-http://localhost:3000}"
EASYPANEL_PROJECT="${EASYPANEL_PROJECT:-yefclub}"
EASYPANEL_SERVICE="${EASYPANEL_SERVICE:-voxen-app}"
MARKER="${EASYPANEL_MARKER:-$HOME/.claude/voxen-last-deployed-sha}"

if [ "${VOXEN_ALLOW_DEPLOY:-}" != "1" ] && [ "$DRY_RUN" != "1" ]; then
  echo "[easypanel-deploy] bloqueado: defina VOXEN_ALLOW_DEPLOY=1 para implantar (auto-deploy desligado)." >&2
  exit 0
fi

# Atualiza ref local da dev antes de decidir o SHA (evita deploy em tip stale).
if git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git -C "$ROOT_DIR" fetch origin dev --quiet 2>/dev/null || true
fi

current_branch="$(git -C "$ROOT_DIR" branch --show-current 2>/dev/null || true)"
if [ "$current_branch" != "dev" ]; then
  echo "[easypanel-deploy] branch atual é '${current_branch:-?}'; checkout dev e pull antes de implantar." >&2
  exit 1
fi

# Preferir origin/dev se existir (fonte da verdade do que o Easypanel clona).
if git -C "$ROOT_DIR" rev-parse --verify origin/dev >/dev/null 2>&1; then
  current_sha="$(git -C "$ROOT_DIR" rev-parse origin/dev)"
  subject="$(git -C "$ROOT_DIR" log -1 --format=%s origin/dev)"
else
  current_sha="$(git -C "$ROOT_DIR" rev-parse HEAD)"
  subject="$(git -C "$ROOT_DIR" log -1 --format=%s HEAD)"
fi

if [ -z "$current_sha" ]; then
  echo "[easypanel-deploy] não foi possível ler o HEAD do git — abortando." >&2
  exit 1
fi

# Gate de formato (Orbital): só implantar commit de versão limpo.
case "$subject" in
  "set version to "*|"chore: set version to "*)
    ;;
  *)
    if [ "${VOXEN_ALLOW_DIRTY_DEPLOY:-}" = "1" ]; then
      echo "[easypanel-deploy] AVISO: HEAD não é bump de versão (subject: $subject) — VOXEN_ALLOW_DIRTY_DEPLOY=1, seguindo." >&2
    else
      printf '%s\n' \
        "[easypanel-deploy] bloqueado: HEAD de dev não é um bump de versão." \
        "  subject atual: $subject" \
        "  sha:           $current_sha" \
        "" \
        "O Easypanel imprime esse subject no log do Deploy. Para aparecer" \
        "  set version to X.Y.Z-dev.<timestamp>" \
        "como no Orbital, espere o workflow version-dev mergear e rode de novo." \
        "" \
        "  git fetch origin && git log origin/dev -1 --oneline" \
        "" \
        "Escape (não recomendado): VOXEN_ALLOW_DIRTY_DEPLOY=1" \
        >&2
      exit 1
    fi
    ;;
esac

last_sha=""
[ -f "$MARKER" ] && last_sha="$(cat "$MARKER" 2>/dev/null || true)"

if [ "$current_sha" = "$last_sha" ]; then
  echo "[easypanel-deploy] já implantado: $subject ($current_sha) — nada a fazer."
  exit 0
fi

if [ "$DRY_RUN" = "1" ]; then
  echo "[easypanel-deploy] dry-run: implantaria $subject ($current_sha) em ${EASYPANEL_PROJECT}/${EASYPANEL_SERVICE}"
  [ -z "${EASYPANEL_API_KEY:-}" ] && echo "[easypanel-deploy] dry-run: EASYPANEL_API_KEY ausente." >&2
  exit 0
fi

if [ -z "${EASYPANEL_API_KEY:-}" ]; then
  echo "[easypanel-deploy] EASYPANEL_API_KEY não definida — abortando." >&2
  exit 1
fi

response_file="$(mktemp "${TMPDIR:-/tmp}/voxen-easypanel-deploy-response.XXXXXX")"

fire_deploy() {
  printf 'header = "Authorization: Bearer %s"\n' "${EASYPANEL_API_KEY}" | curl -s -K - \
    -o "$response_file" -w '%{http_code}' \
    --max-time 20 \
    -X POST "${EASYPANEL_URL}/api/trpc/services.app.deployService" \
    -H "Content-Type: application/json" \
    -d "{\"json\":{\"projectName\":\"${EASYPANEL_PROJECT}\",\"serviceName\":\"${EASYPANEL_SERVICE}\"}}" \
    2>/dev/null || echo "000"
}

echo "[easypanel-deploy] implantando: $subject ($current_sha)"
http_code="$(fire_deploy)"

if [ "$http_code" = "500" ]; then
  echo "[easypanel-deploy] HTTP 500 transitório, retentando em 8s..." >&2
  sleep 8
  http_code="$(fire_deploy)"
fi

if [ "$http_code" = "200" ]; then
  mkdir -p "$(dirname "$MARKER")"
  echo "$current_sha" > "$MARKER"
  echo "[easypanel-deploy] OK — $subject ($current_sha)"
  rm -f "$response_file"
  exit 0
fi

echo "[easypanel-deploy] FALHOU HTTP $http_code — $subject. Resposta: $response_file" >&2
exit 1
