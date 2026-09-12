import { db } from './db';
import { findTranscriptBySourceIdentity } from './transcript-source-identity';
import { parseVideoUrl, type VideoUrl } from './video-url';

const TIKTOK_REDIRECT_HOSTS = new Set([
  'm.tiktok.com',
  'tiktok.com',
  'vm.tiktok.com',
  'vt.tiktok.com',
  'www.tiktok.com',
]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function safeTikTokRedirect(value: string, base?: string): URL | null {
  try {
    const url = new URL(value, base);
    return url.protocol === 'https:' && !url.port && TIKTOK_REDIRECT_HOSTS.has(url.hostname)
      ? url
      : null;
  } catch {
    return null;
  }
}

export async function resolveVideoSourceIdentity(
  video: VideoUrl,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const initial = safeTikTokRedirect(video.canonical);
  if (
    video.source !== 'TIKTOK' ||
    !initial ||
    !['vm.tiktok.com', 'vt.tiktok.com'].includes(initial.hostname)
  ) {
    return video.canonical;
  }

  let current = initial;
  const signal = AbortSignal.timeout(5_000);
  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await fetchImpl(current, {
        method: 'HEAD',
        redirect: 'manual',
        signal,
      });
      if (!REDIRECT_STATUSES.has(response.status)) {
        const parsed = parseVideoUrl(current.toString());
        return parsed?.source === 'TIKTOK' ? parsed.canonical : video.canonical;
      }
      const next = safeTikTokRedirect(response.headers.get('location') ?? '', current.toString());
      if (!next) return video.canonical;
      current = next;
    }
  } catch {
    return video.canonical;
  }
  return video.canonical;
}

export type VideoSourceInspection =
  | { outcome: 'available'; sourceUrl: string }
  | { outcome: 'existing_transcript'; transcriptId: string }
  | { outcome: 'inflight'; jobId: string };

export async function inspectVideoSource(
  userId: string,
  video: VideoUrl,
): Promise<VideoSourceInspection> {
  const candidates = [video.canonical];
  for (const sourceUrl of candidates) {
    const existing = await findTranscriptBySourceIdentity(db, userId, sourceUrl);
    if (existing) return { outcome: 'existing_transcript', transcriptId: existing.id };
    const inflight = await db.job.findFirst({
      where: { userId, sourceUrl, status: { in: ['QUEUED', 'RUNNING'] } },
      select: { id: true },
    });
    if (inflight) return { outcome: 'inflight', jobId: inflight.id };
  }

  const resolved = await resolveVideoSourceIdentity(video);
  if (!candidates.includes(resolved)) candidates.push(resolved);
  if (candidates.length > 1) {
    const existing = await findTranscriptBySourceIdentity(db, userId, resolved);
    if (existing) return { outcome: 'existing_transcript', transcriptId: existing.id };
    const inflight = await db.job.findFirst({
      where: { userId, sourceUrl: resolved, status: { in: ['QUEUED', 'RUNNING'] } },
      select: { id: true },
    });
    if (inflight) return { outcome: 'inflight', jobId: inflight.id };
  }
  return { outcome: 'available', sourceUrl: resolved };
}
