// ============================================================================
// proxy-agent-tunnel — sincroniza o authfile do chisel embutido com o token.
// ============================================================================
// O servidor chisel roda na imagem combinada (ver scripts/easypanel-entrypoint.sh)
// e lê um authfile JSON que mapeia credenciais `user:pass` -> remotes reversos
// permitidos (regex). Aqui geramos esse authfile a partir do `proxy_agent_token`
// (cifrado em DB). O chisel server faz **hot-reload automático** do authfile ao
// detectar mudança no arquivo (fsnotify) — NÃO precisa de sinal. (Atenção:
// SIGHUP no chisel server NÃO recarrega o authfile; sem handler, o processo Go
// termina. Por isso a sincronização é só escrever o arquivo, de forma atômica.)
//
// Defesa em profundidade:
//   - usuário fixo `voxen` + token de alta entropia como senha;
//   - regex restrita ao ÚNICO remote esperado: R:127.0.0.1:1080 (com o sufixo
//     `:socks` opcional — o chisel valida o remote SEM o sufixo de tipo;
//     bind em localhost na VPS — o SOCKS reverso nunca é exposto à rede);
//   - authfile com permissão 600; token NUNCA logado.
//
// Best-effort: em dev (sem chisel / sem /run/voxen) tudo falha silencioso com
// log — nunca quebra o boot nem os endpoints admin.
// ============================================================================

import { writeFileSync, chmodSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { getSetting } from './settings';

// Usuário de auth do chisel (o agente disca com `--auth voxen:<token>`).
const CHISEL_AUTH_USER = 'voxen';

// Remote reverso ÚNICO permitido. O agente residencial pede exatamente este
// remote; o chisel server abre o SOCKS5 em 127.0.0.1:1080 (localhost na VPS).
export const CHISEL_SOCKS_REMOTE = 'R:127.0.0.1:1080:socks';

// Regex (string) usada no authfile pra restringir o remote permitido. O chisel
// valida o remote SEM o sufixo de tipo (`R:127.0.0.1:1080`), então o `:socks`
// é OPCIONAL no match — senão o server nega com "access denied". Pontos
// escapados; âncoras ^...$ pra match exato (sem bind aberto nem outras portas).
const CHISEL_REMOTE_REGEX = '^R:127\\.0\\.0\\.1:1080(:socks)?$';

function authfilePath(): string {
  return process.env.CHISEL_AUTHFILE?.trim() || '/run/voxen/chisel-auth.json';
}

// Path padrão onde a web do Voxen aceita o upgrade de WebSocket do agente e faz
// proxy pro chisel server local. Configurável por env (PROXY_TUNNEL_PATH). O
// agente recebe a URL como https://<url-do-voxen><PATH> e o chisel client faz o
// upgrade pra WebSocket sozinho.
export const DEFAULT_PROXY_TUNNEL_PATH = '/_tunnel';

/**
 * Path (normalizado, começando com `/`) onde a web aceita o WebSocket do túnel.
 * Lê PROXY_TUNNEL_PATH; cai no default `/_tunnel`. Garante prefixo `/` e sem
 * barra final (exceto a raiz, que nunca usamos aqui).
 */
export function proxyTunnelPath(): string {
  const raw = process.env.PROXY_TUNNEL_PATH?.trim();
  if (!raw) return DEFAULT_PROXY_TUNNEL_PATH;
  let path = raw.startsWith('/') ? raw : `/${raw}`;
  // Remove barra final redundante (mas mantém a raiz "/" intocada — embora
  // usar "/" como path do túnel colidiria com tudo, então não recomendamos).
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path;
}

/**
 * Deriva a URL de conexão do túnel — **a própria URL do Voxen** com o path do
 * proxy anexado. O esquema permanece `http://`/`https://`: o chisel client
 * recebe a URL de controle em http(s) e faz o upgrade pra WebSocket sozinho.
 * Passar `wss://`/`ws://` quebra o chisel (`dial tcp: address wss::80: too many
 * colons`), por isso NÃO convertemos o esquema. Ordem:
 *
 *   1. SE `PROXY_TUNNEL_URL` está setado, usa diretamente (operador assume o
 *      controle total — pode apontar pra outro host/porta/path). Se vier com
 *      `ws://`/`wss://`, normaliza pra `http://`/`https://` (o chisel quer http).
 *   2. SENÃO, deriva de `APP_BASE_URL`: esquema http(s) preservado,
 *      hostname/porta preservados, path = `proxyTunnelPath()`
 *      (ex.: https://voxen.exemplo.com/_tunnel).
 *   3. SE nenhuma resolve, retorna `null` (UI orienta a configurar APP_BASE_URL).
 *
 * Auto-coletado: o operador NÃO precisa criar subdomínio `tunnel.` nem digitar
 * a URL — ela sai da URL pública do próprio Voxen.
 */
export function deriveTunnelUrl(): string | null {
  const explicit = process.env.PROXY_TUNNEL_URL?.trim();
  if (explicit) {
    try {
      const url = new URL(explicit);
      // O chisel client quer a URL de controle em http(s) e faz o upgrade pra
      // WebSocket sozinho — normaliza ws/wss caso o operador tenha configurado.
      if (url.protocol === 'wss:') url.protocol = 'https:';
      else if (url.protocol === 'ws:') url.protocol = 'http:';
      return url.toString().replace(/\/$/, '');
    } catch {
      return null;
    }
  }
  const appBase = process.env.APP_BASE_URL?.trim();
  if (!appBase) return null;
  try {
    const url = new URL(appBase);
    // Mantém http(s) — NÃO converte pra ws/wss (o chisel client faz isso).
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.pathname = proxyTunnelPath();
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

/**
 * Monta o conteúdo do authfile do chisel para um dado token.
 * - token presente  -> { "voxen:<token>": ["^R:127\\.0\\.0\\.1:1080:socks$"] }
 * - token ausente   -> {} (chisel nega qualquer conexão)
 *
 * Exportado puro pra ser testável sem tocar filesystem nem DB.
 */
export function buildChiselAuthfile(token: string | null): Record<string, string[]> {
  if (!token) return {};
  return {
    [`${CHISEL_AUTH_USER}:${token}`]: [CHISEL_REMOTE_REGEX],
  };
}

/**
 * Escreve o authfile IN-PLACE (mesmo inode), NÃO via temp+rename. O chisel
 * observa o inode do authfile via fsnotify e só recarrega no evento `Write`; um
 * rename emite `Rename` e deixa o watch pendurado no inode antigo, então o reload
 * NUNCA acontece (revogação de token não teria efeito — falha de segurança). O
 * JSON é minúsculo (uma linha), então o risco de leitura parcial é desprezível.
 * Permissão 600.
 */
export function writeAuthfileInPlace(path: string, content: string): void {
  writeFileSync(path, content, { encoding: 'utf8', mode: 0o600 });
  // Reforça a permissão caso o destino já existisse com modo mais aberto.
  try {
    chmodSync(path, 0o600);
  } catch {
    /* best-effort */
  }
}

/**
 * Sincroniza o authfile do chisel com o estado atual do `proxy_agent_token`.
 * O chisel server detecta a mudança no arquivo e recarrega sozinho (sem sinal).
 *
 * Best-effort: qualquer falha (sem token, sem chisel, sem /run/voxen) é logada
 * e NÃO propaga — não quebra boot nem endpoints admin. NUNCA loga o token.
 */
export async function syncChiselAuthfile(): Promise<void> {
  let token: string | null = null;
  try {
    token = await getSetting('proxy_agent_token');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[proxy-agent] falha ao ler proxy_agent_token: ${message}`);
    return;
  }

  const content = JSON.stringify(buildChiselAuthfile(token));
  const path = authfilePath();
  try {
    writeAuthfileInPlace(path, content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Em dev sem /run/voxen isso é esperado — só informa, não quebra.
    console.warn(`[proxy-agent] não foi possível escrever authfile (${path}): ${message}`);
  }
}

// ============================================================================
// Status ao vivo da conexão do agente
// ============================================================================

/**
 * Porta do SOCKS reverso que o chisel server abre em 127.0.0.1 QUANDO (e somente
 * quando) um agente residencial conecta pedindo o remote R:127.0.0.1:1080:socks.
 * Bind em localhost — nunca exposto à rede. Lê CHISEL_SOCKS_PORT, default 1080.
 */
function chiselSocksPort(): number {
  const raw = process.env.CHISEL_SOCKS_PORT?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : 1080;
}

/**
 * Arquivo de log do chisel server (o entrypoint redireciona stdout/stderr pra cá
 * além do console). Configurável por CHISEL_LOGFILE; default /run/voxen/chisel.log.
 */
function chiselLogfile(): string {
  return process.env.CHISEL_LOGFILE?.trim() || '/run/voxen/chisel.log';
}

/**
 * Faz um TCP connect best-effort ao SOCKS reverso local com timeout curto.
 * - conecta  => há um agente conectado (o chisel só abre essa porta com agente).
 * - recusa / timeout / qualquer erro => nenhum agente (ou dev sem chisel).
 *
 * NUNCA lança: resolve sempre boolean. O socket é destruído em qualquer desfecho
 * pra não pendurar o request de status. Default timeout 1000ms.
 */
export function probeAgentConnected(timeoutMs = 1000): Promise<boolean> {
  const port = chiselSocksPort();
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (connected: boolean): void => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* best-effort */
      }
      resolve(connected);
    };

    const socket = connect({ host: '127.0.0.1', port });
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

// Marcadores que o chisel server loga quando um 2º agente tenta bindar o SOCKS
// reverso já ocupado pelo 1º. A garantia de single-connection vem do port-bind.
const CONFLICT_MARKERS = ['address already in use', 'bind: address already in use'];

/**
 * Extrai do conteúdo de log se há sinal recente de conflito de múltiplos agentes.
 * Pura (sem I/O): testável diretamente. Olha só as últimas `tailLines` linhas
 * (default 200) pra não reagir a um conflito antigo já resolvido.
 */
export function detectConflictInLog(logContent: string, tailLines = 200): boolean {
  if (!logContent) return false;
  const lines = logContent.split('\n');
  const tail = lines.slice(-tailLines);
  return tail.some((line) => {
    const lower = line.toLowerCase();
    return CONFLICT_MARKERS.some((marker) => lower.includes(marker));
  });
}

/**
 * Lê o log do chisel (best-effort) e detecta conflito de múltiplos agentes.
 * Sem arquivo (dev / sem chisel) => false, sem erro. NUNCA loga conteúdo do log.
 */
export async function readConflictFlag(): Promise<boolean> {
  const path = chiselLogfile();
  try {
    const content = await readFile(path, 'utf8');
    return detectConflictInLog(content);
  } catch {
    // Sem log (dev, ou chisel nunca subiu) — sem conflito a reportar.
    return false;
  }
}
