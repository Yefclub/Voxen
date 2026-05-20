// ============================================================================
// Source detection — espelho do parseVideoUrl/normalizeWebUrl do server.
// ============================================================================
// Decide se uma URL é vídeo (YT/IG/TT) ou web genérica. Usado pra preview no
// /jobs antes do submit e pra escolher thumbnail/ícone nos cards. Mantém em
// sync com `apps/web/src/lib/video-url.ts` (server-side).
// ============================================================================

export type DetectedSource = 'YOUTUBE' | 'INSTAGRAM' | 'TIKTOK' | 'X' | 'WEB';

export function detectSourceFromUrl(raw: string): DetectedSource | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  const host = url.hostname.replace(/^www\.|^m\.|^mobile\.|^music\./, '');

  if (host === 'youtu.be' || host === 'youtube.com') return 'YOUTUBE';
  if (host === 'instagram.com') return 'INSTAGRAM';
  if (host === 'tiktok.com' || host === 'vm.tiktok.com' || host === 'vt.tiktok.com')
    return 'TIKTOK';
  if (host === 'x.com' || host === 'twitter.com') return 'X';

  // Qualquer outra http(s) é tratada como página web pra scrape
  return 'WEB';
}

// Extrai videoId YT pra thumbnail oficial (mqdefault). null se não YT.
export function youtubeVideoId(raw: string): string | null {
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\.|^m\.|^music\./, '');
    let id: string | null = null;
    if (host === 'youtu.be') {
      id = u.pathname.replace(/^\//, '').split('/')[0] ?? null;
    } else if (host === 'youtube.com') {
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'v') {
        id = parts[1] ?? null;
      } else {
        id = u.searchParams.get('v');
      }
    }
    if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) return id;
  } catch {
    // ignora
  }
  return null;
}

export function uploadFilenameFromSourceUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'upload:') return null;
    const encoded = url.pathname.replace(/^\//, '');
    if (!encoded) return null;
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

export function isUploadSourceUrl(raw: string): boolean {
  return uploadFilenameFromSourceUrl(raw) !== null;
}

export function displayJobSource(raw: string): string {
  const uploadName = uploadFilenameFromSourceUrl(raw);
  if (!uploadName) return raw;
  if (isImageUploadName(uploadName)) return `Imagem enviada: ${uploadName}`;
  if (isDocumentUploadName(uploadName)) return `Documento enviado: ${uploadName}`;
  return `Arquivo enviado: ${uploadName}`;
}

export function isExternalSourceUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isImageUploadName(filename: string): boolean {
  return /\.(png|jpe?g|webp|gif)$/i.test(filename);
}

function isDocumentUploadName(filename: string): boolean {
  return /\.(pdf|docx|pptx|xlsx?|csv|txt|md|json|xml|html?|epub)$/i.test(filename);
}
