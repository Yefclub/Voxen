/**
 * URL de capa segura para <img>.
 *
 * Nunca usa CDN assinada de TikTok/IG no browser — essas URLs expiram e
 * geram "Access Denied" (Akamai). Sempre preferimos o endpoint interno que
 * serve o objeto no S3 ou um SVG placeholder.
 */
export function resolveTranscriptPreviewSrc(
  transcriptId: string,
  thumbnailUrl?: string | null,
): string {
  const t = (thumbnailUrl ?? '').trim();
  if (t.startsWith('/api/transcripts/') && t.includes('/preview')) {
    return t;
  }
  // Relativo interno legítimo
  if (t.startsWith('/api/') && !t.startsWith('http')) {
    return t;
  }
  return `/api/transcripts/${transcriptId}/preview`;
}

/** Capas remotas (http/https) não devem ir direto no <img>. */
export function isRemoteThumbnailUrl(url: string | null | undefined): boolean {
  const t = (url ?? '').trim();
  return t.startsWith('http://') || t.startsWith('https://');
}
