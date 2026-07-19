#!/bin/sh
# ============================================================================
# Dispara redeploy do voxen-app no Easypanel (home lab, projeto yefclub).
# ============================================================================
# MANUAL — não há hook automático pós-git-pull. Rode este script (ou o painel
# Easypanel / workflow "Easypanel Image") quando quiser implantar.
#
# Idempotente: só deploya se a dev avançou desde o último deploy bem-sucedido
# (marcador de SHA em disco). Seguro pra chamar repetidamente sem redeploy
# duplicado do mesmo commit.
#
# Nunca lê nem grava a API key em nenhum arquivo — ela deve vir do ambiente
# (EASYPANEL_API_KEY), tipicamente via um arquivo local fora do repo com
# permissão restrita, sourced antes de chamar este script.
#
# Config (todas opcionais, com default pro home lab já validado):
#   EASYPANEL_URL      (default http://localhost:3000)
#   EASYPANEL_PROJECT  (default yefclub)
#   EASYPANEL_SERVICE  (default voxen-app)
#   EASYPANEL_MARKER   (default ~/.claude/voxen-last-deployed-sha)
#
# Uso: scripts/easypanel-deploy.sh [--dry-run]
# ============================================================================
set -eu

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
EASYPANEL_URL="${EASYPANEL_URL:-http://localhost:3000}"
EASYPANEL_PROJECT="${EASYPANEL_PROJECT:-yefclub}"
EASYPANEL_SERVICE="${EASYPANEL_SERVICE:-voxen-app}"
MARKER="${EASYPANEL_MARKER:-$HOME/.claude/voxen-last-deployed-sha}"

current_sha="$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || true)"
current_branch="$(git -C "$ROOT_DIR" branch --show-current 2>/dev/null || true)"

if [ -z "$current_sha" ]; then
  echo "[easypanel-deploy] não foi possível ler o HEAD do git em $ROOT_DIR — abortando." >&2
  exit 1
fi

if [ "$current_branch" != "dev" ]; then
  echo "[easypanel-deploy] branch atual é '$current_branch', não 'dev' — nada a fazer."
  exit 0
fi

last_sha=""
[ -f "$MARKER" ] && last_sha="$(cat "$MARKER" 2>/dev/null || true)"

if [ "$current_sha" = "$last_sha" ]; then
  echo "[easypanel-deploy] dev já está no SHA implantado ($current_sha) — nada a fazer."
  exit 0
fi

if [ "$DRY_RUN" = "1" ]; then
  echo "[easypanel-deploy] dry-run: dispararia deploy de ${EASYPANEL_PROJECT}/${EASYPANEL_SERVICE} em ${EASYPANEL_URL} pro SHA $current_sha (marcador atual: '${last_sha:-nenhum}')."
  [ -z "${EASYPANEL_API_KEY:-}" ] && echo "[easypanel-deploy] dry-run: aviso — EASYPANEL_API_KEY não está definida agora; a chamada real falharia até isso ser corrigido." >&2
  exit 0
fi

if [ -z "${EASYPANEL_API_KEY:-}" ]; then
  echo "[easypanel-deploy] EASYPANEL_API_KEY não definida no ambiente — pulando deploy (SHA $current_sha não registrado, tentará de novo na próxima chamada)." >&2
  exit 1
fi

# Arquivo de resposta com nome imprevisível e 0600 (mktemp) — evita symlink
# pré-plantado num caminho fixo em /tmp (CWE-377). Removido em sucesso; mantido
# (e apontado na mensagem de erro) em falha, pra permitir diagnóstico.
response_file="$(mktemp "${TMPDIR:-/tmp}/voxen-easypanel-deploy-response.XXXXXX")"

fire_deploy() {
  # A chave NUNCA vai como argumento de linha de comando do curl (ficaria
  # visível via `ps`/`/proc/<pid>/cmdline` pra outros usuários da máquina) —
  # vai só pelo header lido via `-K -` (config do curl no stdin).
  printf 'header = "Authorization: Bearer %s"\n' "${EASYPANEL_API_KEY}" | curl -s -K - \
    -o "$response_file" -w '%{http_code}' \
    --max-time 20 \
    -X POST "${EASYPANEL_URL}/api/trpc/services.app.deployService" \
    -H "Content-Type: application/json" \
    -d "{\"json\":{\"projectName\":\"${EASYPANEL_PROJECT}\",\"serviceName\":\"${EASYPANEL_SERVICE}\"}}" \
    2>/dev/null || echo "000"
}

http_code="$(fire_deploy)"

# 500 transitório é conhecido (build concorrente no Easypanel) — uma retentativa
# curta resolve na prática; não é um loop de backoff genérico.
if [ "$http_code" = "500" ]; then
  echo "[easypanel-deploy] HTTP 500 transitório, retentando em 8s..." >&2
  sleep 8
  http_code="$(fire_deploy)"
fi

if [ "$http_code" = "200" ]; then
  mkdir -p "$(dirname "$MARKER")"
  echo "$current_sha" > "$MARKER"
  echo "[easypanel-deploy] deploy disparado com sucesso pro SHA $current_sha (HTTP $http_code)."
  rm -f "$response_file"
  exit 0
fi

echo "[easypanel-deploy] deploy FALHOU (HTTP $http_code) pro SHA $current_sha — marcador NÃO atualizado, tentará de novo na próxima chamada. Resposta em $response_file." >&2
exit 1
