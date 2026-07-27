/**
 * Helpers para exibir a URL de origem do conteúdo (YouTube/TikTok/web/etc.).
 */

export function isExternalSourceUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.startsWith('https://') || url.startsWith('http://');
}

/** Host limpo (sem www.) ou null se URL inválida/interna. */
export function sourceHostname(url: string | null | undefined): string | null {
  if (!isExternalSourceUrl(url)) return null;
  try {
    const host = new URL(url!).hostname.replace(/^www\./i, '');
    return host || null;
  } catch {
    return null;
  }
}

/**
 * Caminho/query enxuto para UI (ex.: /@user/video/123…).
 * Sem host — combinar com sourceHostname.
 */
export function sourcePathLabel(url: string | null | undefined, maxLen = 48): string | null {
  if (!isExternalSourceUrl(url)) return null;
  try {
    const u = new URL(url!);
    const path = `${u.pathname}${u.search}`.replace(/\/$/, '') || '/';
    if (path.length <= maxLen) return path;
    return `${path.slice(0, Math.max(8, maxLen - 1))}…`;
  } catch {
    return null;
  }
}

/** Texto de uma linha: host + path truncado. */
export function sourceDisplayLine(url: string | null | undefined): string | null {
  const host = sourceHostname(url);
  if (!host) return null;
  const path = sourcePathLabel(url, 40);
  if (!path || path === '/') return host;
  return `${host}${path}`;
}
