// ============================================================================
// platform-cookies — cookies de plataforma capturados pela extensão (spec 121)
// ============================================================================
// O worker lê UMA setting (`yt_dlp_cookies`) e a materializa num único
// `cookiefile` do yt-dlp, que filtra por domínio sozinho. Então as três
// plataformas convivem no MESMO arquivo Netscape e gravar uma plataforma é um
// MERGE POR DOMÍNIO, não um overwrite:
//
//   1. linhas do domínio da plataforma gravada saem;
//   2. todo o resto é preservado verbatim — inclusive domínios fora das três
//      plataformas, que o operador possa ter colado manualmente antes desta
//      feature;
//   3. o bloco novo entra no fim.
//
// O valor NUNCA sai daqui pra resposta HTTP nem pra log: as funções que
// validam devolvem erro com número da linha, jamais o conteúdo dela.
//
// Rigor na validação é requisito de robustez, não zelo: o parser do yt-dlp
// (`prepare_line`) levanta LoadError na PRIMEIRA linha malformada e descarta o
// arquivo inteiro — uma captura ruim derrubaria a extração de todas as
// plataformas, não só a dela.
// ============================================================================

export const NETSCAPE_HEADER = '# Netscape HTTP Cookie File';

/** Prefixo que o yt-dlp aceita pra marcar cookie httpOnly. Não emitimos (a
 *  stdlib do Python trata como comentário e descarta), mas sabemos ler. */
const HTTPONLY_PREFIX = '#HttpOnly_';

export const COOKIE_PLATFORMS = ['tiktok', 'instagram', 'youtube'] as const;
export type CookiePlatform = (typeof COOKIE_PLATFORMS)[number];

/** Domínio-base de cada plataforma. YouTube fica em `youtube.com` de
 *  propósito: `google.com` traria a conta Google inteira junto. */
export const PLATFORM_COOKIE_DOMAINS: Record<CookiePlatform, string> = {
  tiktok: 'tiktok.com',
  instagram: 'instagram.com',
  youtube: 'youtube.com',
};

/** 7 dias — depois disso a captura é sinalizada como possivelmente expirada. */
export const COOKIE_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** Tetos defensivos pro payload recebido da extensão. */
const MAX_COOKIE_LINES = 400;
const MAX_PAYLOAD_CHARS = 256 * 1024;

const ENTRY_FIELDS = 7;

export function isCookiePlatform(value: unknown): value is CookiePlatform {
  return typeof value === 'string' && (COOKIE_PLATFORMS as readonly string[]).includes(value);
}

/** Igual ao domínio-base ou subdomínio dele. `eviltiktok.com` não casa. */
export function cookieDomainMatches(cookieDomain: string, baseDomain: string): boolean {
  const raw = cookieDomain.trim().toLowerCase().replace(/^\./, '');
  const base = baseDomain.trim().toLowerCase();
  if (!raw || !base) return false;
  return raw === base || raw.endsWith(`.${base}`);
}

function platformOfDomain(cookieDomain: string): CookiePlatform | null {
  for (const platform of COOKIE_PLATFORMS) {
    if (cookieDomainMatches(cookieDomain, PLATFORM_COOKIE_DOMAINS[platform])) return platform;
  }
  return null;
}

/** Linha de dados (com o prefixo httpOnly já removido) ou null se é
 *  comentário/linha em branco. */
function asDataLine(line: string): string | null {
  const trimmed = line.trimEnd();
  if (!trimmed.trim()) return null;
  if (trimmed.startsWith(HTTPONLY_PREFIX)) return trimmed.slice(HTTPONLY_PREFIX.length);
  if (trimmed.startsWith('#')) return null;
  return trimmed;
}

/** Domínio de uma linha já reconhecida como linha de dados. */
function domainOfDataLine(dataLine: string): string {
  return dataLine.split('\t')[0] ?? '';
}

export type ParseResult =
  | { ok: true; lines: string[] }
  | { ok: false; error: string; status: 400 | 413 | 422 };

/**
 * Valida o documento Netscape recebido da extensão e devolve as linhas de
 * dados normalizadas (sem cabeçalho, sem prefixo httpOnly).
 *
 * Toda linha precisa: ter 7 campos separados por TAB, flags TRUE/FALSE,
 * expiração só com dígitos, nome não-vazio e domínio pertencente à plataforma
 * declarada. Domínio de fora é rejeitado (não ignorado) — senão um cliente
 * adulterado gravaria cookie de qualquer site usando a rota "do TikTok".
 */
export function parseCapturedCookies(platform: CookiePlatform, raw: unknown): ParseResult {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, error: 'Nenhum cookie recebido.', status: 400 };
  }
  if (raw.length > MAX_PAYLOAD_CHARS) {
    return { ok: false, error: 'Payload de cookies grande demais.', status: 413 };
  }

  const base = PLATFORM_COOKIE_DOMAINS[platform];
  const lines: string[] = [];
  let index = 0;

  for (const rawLine of raw.split(/\r?\n/)) {
    const dataLine = asDataLine(rawLine);
    if (dataLine === null) continue;
    index += 1;
    if (index > MAX_COOKIE_LINES) {
      return { ok: false, error: 'Cookies demais numa única captura.', status: 413 };
    }

    const fields = dataLine.split('\t');
    if (fields.length !== ENTRY_FIELDS) {
      return { ok: false, error: `Linha ${index} inválida: número de campos.`, status: 422 };
    }
    const [domain, includeSub, path, secure, expires, name] = fields as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    if (includeSub !== 'TRUE' && includeSub !== 'FALSE') {
      return { ok: false, error: `Linha ${index} inválida: flag de subdomínio.`, status: 422 };
    }
    if (secure !== 'TRUE' && secure !== 'FALSE') {
      return { ok: false, error: `Linha ${index} inválida: flag de secure.`, status: 422 };
    }
    if (!/^\d+$/.test(expires)) {
      return { ok: false, error: `Linha ${index} inválida: expiração.`, status: 422 };
    }
    if (!path.startsWith('/')) {
      return { ok: false, error: `Linha ${index} inválida: path.`, status: 422 };
    }
    if (!name) {
      return { ok: false, error: `Linha ${index} inválida: nome vazio.`, status: 422 };
    }
    if (!cookieDomainMatches(domain, base)) {
      return {
        ok: false,
        error: `Linha ${index} inválida: domínio fora da plataforma "${platform}".`,
        status: 422,
      };
    }

    lines.push(dataLine);
  }

  if (lines.length === 0) {
    return { ok: false, error: 'Nenhum cookie válido recebido.', status: 400 };
  }
  return { ok: true, lines };
}

/** Linhas do arquivo atual que NÃO pertencem à plataforma informada,
 *  preservadas exatamente como estavam (inclusive prefixo httpOnly). */
function linesExcludingPlatform(existing: string | null, platform: CookiePlatform): string[] {
  if (!existing) return [];
  const kept: string[] = [];
  for (const rawLine of existing.split(/\r?\n/)) {
    const dataLine = asDataLine(rawLine);
    if (dataLine === null) continue;
    if (platformOfDomain(domainOfDataLine(dataLine)) === platform) continue;
    kept.push(rawLine.trimEnd());
  }
  return kept;
}

function compose(lines: string[]): string {
  if (lines.length === 0) return '';
  return `${NETSCAPE_HEADER}\n${lines.join('\n')}\n`;
}

/** Substitui o bloco da plataforma preservando todo o resto. */
export function mergePlatformCookies(
  existing: string | null,
  platform: CookiePlatform,
  newLines: string[],
): string {
  return compose([...linesExcludingPlatform(existing, platform), ...newLines]);
}

/** Remove o bloco da plataforma. String vazia quando não sobra nada — o
 *  chamador apaga a setting nesse caso. */
export function removePlatformCookies(existing: string | null, platform: CookiePlatform): string {
  return compose(linesExcludingPlatform(existing, platform));
}

export function hasPlatformCookie(existing: string | null, platform: CookiePlatform): boolean {
  if (!existing) return false;
  const base = PLATFORM_COOKIE_DOMAINS[platform];
  for (const rawLine of existing.split(/\r?\n/)) {
    const dataLine = asDataLine(rawLine);
    if (dataLine === null) continue;
    if (cookieDomainMatches(domainOfDataLine(dataLine), base)) return true;
  }
  return false;
}

/**
 * `capturedAt` desconhecido → NÃO é stale: sem data não dá pra afirmar que
 * expirou, e alarme falso é pior que silêncio (cookie colado manualmente
 * antes desta feature cai nesse caso).
 */
export function isCaptureStale(capturedAt: string | null, now: Date = new Date()): boolean {
  if (!capturedAt) return false;
  const ts = Date.parse(capturedAt);
  if (Number.isNaN(ts)) return false;
  return now.getTime() - ts > COOKIE_STALE_AFTER_MS;
}

export type CaptureMeta = Partial<Record<CookiePlatform, { capturedAt: string }>>;

/** Metadado é best-effort: JSON corrompido vira `{}` em vez de derrubar a
 *  rota — o valor real dos cookies não depende dele. */
export function parseCaptureMeta(raw: string | null): CaptureMeta {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: CaptureMeta = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!isCookiePlatform(key)) continue;
    if (!value || typeof value !== 'object') continue;
    const capturedAt = (value as Record<string, unknown>).capturedAt;
    if (typeof capturedAt !== 'string' || Number.isNaN(Date.parse(capturedAt))) continue;
    out[key] = { capturedAt };
  }
  return out;
}

export function serializeCaptureMeta(meta: CaptureMeta): string {
  return JSON.stringify(meta);
}
