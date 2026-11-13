import { getUserSetting } from '../settings';
import { createCaptureWorkerClient } from '../capture/worker-client';
import { isCaptureUrlError, parseCaptureUrl } from '../capture/url';

export async function searchWeb(userId: string, query: string, signal: AbortSignal) {
  const key = await getUserSetting(userId, 'assistant_search_key');
  if (!key) return { error: 'WEB_NOT_CONFIGURED', sources: [] };
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query.slice(0, 400));
  url.searchParams.set('count', '5');
  const response = await fetch(url, {
    headers: { 'X-Subscription-Token': key, Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
  });
  if (!response.ok) throw new Error('WEB_SEARCH_FAILED');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('WEB_SEARCH_FAILED');
  const parts: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    bytes += next.value.byteLength;
    if (bytes > 1024 * 1024) {
      await reader.cancel();
      throw new Error('WEB_RESULT_TOO_LARGE');
    }
    parts.push(next.value);
  }
  const body = JSON.parse(Buffer.concat(parts).toString()) as {
    web?: { results?: Array<{ url?: string; title?: string; description?: string }> };
  };
  return {
    retrievedAt: new Date().toISOString(),
    sources: (body.web?.results ?? []).slice(0, 5).flatMap((item) => {
      const parsed = parseCaptureUrl(item.url);
      return isCaptureUrlError(parsed)
        ? []
        : [
            {
              url: parsed.url,
              title: item.title?.slice(0, 250) ?? parsed.url,
              excerpt: item.description?.slice(0, 1500) ?? '',
            },
          ];
    }),
  };
}

export async function fetchWebPage(url: string, signal: AbortSignal) {
  const parsed = parseCaptureUrl(url);
  if (isCaptureUrlError(parsed)) return { error: parsed.code };
  const page = await createCaptureWorkerClient().extract(
    parsed.url,
    AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
  );
  const canonical = parseCaptureUrl(page.canonicalUrl);
  return {
    url: isCaptureUrlError(canonical) ? parsed.url : canonical.url,
    title: page.title,
    retrievedAt: new Date().toISOString(),
    text: (page.text ?? '').slice(0, 20_000),
    truncated: (page.text?.length ?? 0) > 20_000,
  };
}
