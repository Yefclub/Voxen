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
//   - regex restrita ao ÚNICO remote esperado: R:127.0.0.1:1080:socks
//     (bind em localhost na VPS — o SOCKS reverso nunca é exposto à rede);
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

// Regex (string) usada no authfile pra restringir o remote permitido a ESTE
// exato valor. Pontos escapados; âncoras ^...$ pra match exato.
const CHISEL_REMOTE_REGEX = '^R:127\\.0\\.0\\.1:1080:socks$';

function authfilePath(): string {
  return process.env.CHISEL_AUTHFILE?.trim() || '/run/voxen/chisel-auth.json';
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
