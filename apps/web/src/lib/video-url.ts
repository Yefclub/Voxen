// ============================================================================
// Video URL — parser + canonicalização (YouTube / Instagram / TikTok / X)
// ============================================================================
// Detecta a plataforma pela URL e devolve forma canônica + source enum.
// Plataformas suportadas no MVP (público only, sem cookies):
//   YOUTUBE   — youtu.be/<id>, youtube.com/watch?v=<id>, /shorts/<id>, /embed/<id>
//   INSTAGRAM — instagram.com/{reel|reels|p|tv}/<code>
//   TIKTOK    — tiktok.com/@user/video/<id>, vm.tiktok.com/<short>, vt.tiktok.com/<short>
//   X         — x.com/<user>/status/<id>, twitter.com/<user>/status/<id>
// ============================================================================

export type VideoSource = 'YOUTUBE' | 'INSTAGRAM' | 'TIKTOK' | 'X';

export interface VideoUrl {
  source: VideoSource;
  canonical: string;
  videoId: string;
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const IG_CODE = /^[A-Za-z0-9_-]+$/;
const TT_ID = /^[0-9]{6,32}$/;
const TT_SHORT = /^[A-Za-z0-9_-]+$/;
const X_STATUS_ID = /^[0-9]{6,32}$/;

export function parseVideoUrl(input: string): VideoUrl | null {
  if (typeof input !== 'string' || input.length === 0) return null;
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  return parseYouTube(url) ?? parseInstagram(url) ?? parseTikTok(url) ?? parseX(url);
}

function parseYouTube(url: URL): VideoUrl | null {
  const host = url.hostname.replace(/^www\.|^m\.|^music\./, '');
  let videoId: string | null = null;
  if (host === 'youtu.be') {
    videoId = url.pathname.slice(1).split('/')[0] ?? null;
  } else if (host === 'youtube.com') {
    const path = url.pathname;
    if (path === '/watch') {
      videoId = url.searchParams.get('v');
    } else if (path.startsWith('/shorts/')) {
      videoId = path.slice('/shorts/'.length).split('/')[0] ?? null;
    } else if (path.startsWith('/embed/')) {
      videoId = path.slice('/embed/'.length).split('/')[0] ?? null;
    } else if (path.startsWith('/v/')) {
      videoId = path.slice('/v/'.length).split('/')[0] ?? null;
    }
  }
  if (!videoId || !YT_ID.test(videoId)) return null;
  return {
    source: 'YOUTUBE',
    videoId,
    canonical: `https://youtu.be/${videoId}`,
  };
}

function parseInstagram(url: URL): VideoUrl | null {
  const host = url.hostname.replace(/^www\.|^m\./, '');
  if (host !== 'instagram.com') return null;
  const parts = url.pathname.split('/').filter(Boolean);
  // Aceita /reel/<code>, /reels/<code>, /p/<code>, /tv/<code>
  // Também aceita /<user>/reel/<code> (formato com username)
  let code: string | null = null;
  const reelTypes = new Set(['reel', 'reels', 'p', 'tv']);
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i] && reelTypes.has(parts[i] as string)) {
      code = parts[i + 1] ?? null;
      break;
    }
  }
  if (!code || !IG_CODE.test(code)) return null;
  return {
    source: 'INSTAGRAM',
    videoId: code,
    canonical: `https://www.instagram.com/reel/${code}/`,
  };
}

function parseTikTok(url: URL): VideoUrl | null {
  const host = url.hostname.replace(/^www\.|^m\./, '');

  // Short links — não dá pra resolver no client, mantém como está pra worker resolver
  if (host === 'vm.tiktok.com' || host === 'vt.tiktok.com') {
    const code = url.pathname.replace(/^\/|\/$/g, '');
    if (!code || !TT_SHORT.test(code)) return null;
    return {
      source: 'TIKTOK',
      videoId: code,
      canonical: `https://${host}/${code}`,
    };
  }

  if (host !== 'tiktok.com') return null;
  const parts = url.pathname.split('/').filter(Boolean);
  // /@user/video/<id>
  if (parts[0]?.startsWith('@') && parts[1] === 'video' && parts[2]) {
    const id = parts[2];
    if (!TT_ID.test(id)) return null;
    return {
      source: 'TIKTOK',
      videoId: id,
      canonical: `https://www.tiktok.com/${parts[0]}/video/${id}`,
    };
  }
  // /video/<id> (raro)
  if (parts[0] === 'video' && parts[1] && TT_ID.test(parts[1])) {
    return {
      source: 'TIKTOK',
      videoId: parts[1],
      canonical: `https://www.tiktok.com/video/${parts[1]}`,
    };
  }
  return null;
}

function parseX(url: URL): VideoUrl | null {
  // x.com (novo domínio) e twitter.com (legacy). Aceita também www. e mobile.
  const host = url.hostname.replace(/^www\.|^mobile\.|^m\./, '');
  if (host !== 'x.com' && host !== 'twitter.com') return null;
  // Formato: /<user>/status/<id>  ou  /i/status/<id>  ou  /i/web/status/<id>
  const parts = url.pathname.split('/').filter(Boolean);
  // Procura "status" e pega o próximo segmento
  const idx = parts.indexOf('status');
  const statusId = idx >= 0 ? parts[idx + 1] : undefined;
  if (!statusId || !X_STATUS_ID.test(statusId)) return null;
  // yt-dlp aceita https://x.com/i/status/<id> (forma minimalista)
  return {
    source: 'X',
    videoId: statusId,
    canonical: `https://x.com/i/status/${statusId}`,
  };
}
