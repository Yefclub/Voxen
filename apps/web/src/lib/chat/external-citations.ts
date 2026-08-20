import type { ChatCitation } from '../../shared/chat-citations';
import type { StoredToolEvent } from './runtime';

type WebCitation = {
  url: string;
  title: string | null;
  content: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asWebCitation(value: unknown): WebCitation | null {
  const record = asRecord(value);
  if (!record || typeof record.url !== 'string') return null;
  let url: URL;
  try {
    url = new URL(record.url);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  return {
    url: url.toString(),
    title: typeof record.title === 'string' && record.title.trim() ? record.title.trim() : null,
    content:
      typeof record.content === 'string' && record.content.trim() ? record.content.trim() : null,
  };
}

export function webCitationsFromToolEvents(
  events: readonly Pick<StoredToolEvent, 'name' | 'state' | 'output'>[],
  firstOrdinal = 0,
): ChatCitation[] {
  // `tools` é preenchido no momento da chamada e os resultados substituem o
  // mesmo índice; esta ordem é a mesma exposta ao agente para [[n]].
  const seen = new Set<string>();
  const citations: ChatCitation[] = [];
  for (const event of events) {
    if ((event.name !== 'web_search' && event.name !== 'search_x') || event.state !== 'completed')
      continue;
    const output = asRecord(event.output);
    if (!Array.isArray(output?.citations)) continue;
    for (const source of output.citations
      .map(asWebCitation)
      .filter((citation): citation is WebCitation => citation !== null)) {
      const key = `web:${source.url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      citations.push({
        sourceType: 'WEB',
        sourceId: source.url,
        title: source.title ?? new URL(source.url).hostname,
        quote: source.content ?? source.url,
        context: source.content,
        fromLine: null,
        toLine: null,
        fromSec: null,
        toSec: null,
        href: source.url,
        kind: 'INFERENCE',
        verified: false,
        inlineOrdinal: firstOrdinal + citations.length + 1,
      });
    }
  }
  return citations;
}
