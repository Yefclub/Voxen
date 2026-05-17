// ============================================================================
// YouTube URL — parser + canonicalização
// ============================================================================
// Patterns aceitos (spec 002):
//   - https://youtu.be/<id>
//   - https://www.youtube.com/watch?v=<id>
//   - https://youtube.com/watch?v=<id>
//   - https://www.youtube.com/shorts/<id>
//   - https://m.youtube.com/watch?v=<id>
// O id do YT tem exatamente 11 caracteres [A-Za-z0-9_-].
// ============================================================================

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

export interface YoutubeUrl {
  videoId: string;
  canonical: string;
}

export function parseYoutubeUrl(input: string): YoutubeUrl | null {
  if (typeof input !== 'string' || input.length === 0) return null;
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '');
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
    }
  }

  if (!videoId || !YT_ID.test(videoId)) return null;

  return {
    videoId,
    canonical: `https://youtu.be/${videoId}`,
  };
}
