#!/bin/sh
# voxen-proxy-agent entrypoint
#
# Monta e executa o comando do chisel client a partir das variáveis de ambiente.
# Recusa iniciar sem URL e token (spec 058, R7). NUNCA loga o token.
set -eu

# --- Configuração via env -----------------------------------------------------
# Obrigatórias:
#   VOXEN_TUNNEL_URL     URL de controle do túnel (ex.: https://tunnel.exemplo.com)
#   VOXEN_TUNNEL_TOKEN   Token gerado na UI admin do Voxen (credencial de auth)
# Opcionais:
#   VOXEN_SOCKS_REMOTE       Remote reverso (default: R:1080:socks)
#   VOXEN_TUNNEL_FINGERPRINT Fingerprint do server pra host-key pinning
#   VOXEN_KEEPALIVE          Intervalo de keepalive (default: 25s)
#   VOXEN_MAX_RETRY_INTERVAL Espera máxima entre tentativas (default: 30s)
#   VOXEN_AUTH_USER          Usuário de auth (default: voxen)

VOXEN_TUNNEL_URL="${VOXEN_TUNNEL_URL:-}"
VOXEN_TUNNEL_TOKEN="${VOXEN_TUNNEL_TOKEN:-}"
VOXEN_SOCKS_REMOTE="${VOXEN_SOCKS_REMOTE:-R:1080:socks}"
VOXEN_TUNNEL_FINGERPRINT="${VOXEN_TUNNEL_FINGERPRINT:-}"
VOXEN_KEEPALIVE="${VOXEN_KEEPALIVE:-25s}"
VOXEN_MAX_RETRY_INTERVAL="${VOXEN_MAX_RETRY_INTERVAL:-30s}"
VOXEN_AUTH_USER="${VOXEN_AUTH_USER:-voxen}"

# --- Validação (R7: recusa sem token) ----------------------------------------
fail=0
if [ -z "${VOXEN_TUNNEL_URL}" ]; then
  echo "ERRO: VOXEN_TUNNEL_URL nao definida (ex.: https://tunnel.exemplo.com)." >&2
  fail=1
fi
if [ -z "${VOXEN_TUNNEL_TOKEN}" ]; then
  echo "ERRO: VOXEN_TUNNEL_TOKEN nao definida. Gere o token na UI admin do Voxen." >&2
  fail=1
fi
if [ "${fail}" -ne 0 ]; then
  echo "Agente nao pode iniciar sem URL e token. Abortando." >&2
  exit 1
fi

# Exige TLS fim-a-fim: a URL de controle deve ser https/wss (spec 058, R8).
case "${VOXEN_TUNNEL_URL}" in
  https://*|wss://*) : ;;
  *)
    echo "ERRO: VOXEN_TUNNEL_URL deve usar https:// (TLS). Recebido um esquema sem TLS." >&2
    exit 1
    ;;
esac

# --- Log seguro (token mascarado, NUNCA em texto plano) ----------------------
echo "voxen-proxy-agent: conectando a ${VOXEN_TUNNEL_URL}"
echo "voxen-proxy-agent: remote=${VOXEN_SOCKS_REMOTE} user=${VOXEN_AUTH_USER} token=********"
if [ -n "${VOXEN_TUNNEL_FINGERPRINT}" ]; then
  echo "voxen-proxy-agent: host-key pinning habilitado (fingerprint configurado)"
else
  echo "voxen-proxy-agent: AVISO — sem VOXEN_TUNNEL_FINGERPRINT; pinning de host-key desabilitado."
fi

# --- Monta argumentos do chisel client ---------------------------------------
# Reconexão automática infinita (--max-retry-count -1). Auth e fingerprint
# passados como argumentos posicionados; o token jamais é ecoado.
set -- client \
  --keepalive "${VOXEN_KEEPALIVE}" \
  --max-retry-count -1 \
  --max-retry-interval "${VOXEN_MAX_RETRY_INTERVAL}" \
  --auth "${VOXEN_AUTH_USER}:${VOXEN_TUNNEL_TOKEN}"

if [ -n "${VOXEN_TUNNEL_FINGERPRINT}" ]; then
  set -- "$@" --fingerprint "${VOXEN_TUNNEL_FINGERPRINT}"
fi

set -- "$@" "${VOXEN_TUNNEL_URL}" "${VOXEN_SOCKS_REMOTE}"

# exec pra que o chisel vire PID 1 (sob tini) e receba sinais diretamente.
exec chisel "$@"
