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
 * - token presente  -> { "voxen:<token>": ["^R:127\\.0\\.0\\.1:1080(:socks)?$"] }
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
