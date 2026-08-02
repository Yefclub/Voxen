export type CitationKind = 'EVIDENCE' | 'NO_EVIDENCE' | 'INFERENCE';

export type ChatCitation = {
  sourceType: 'TRANSCRIPT';
  sourceId: string;
  title: string;
  quote: string;
  context: string | null;
  fromLine: number | null;
  toLine: number | null;
  fromSec: number | null;
  toSec: number | null;
  href: string;
  kind: CitationKind;
  verified: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Defesa da fronteira JSONB para mensagens antigas/corrompidas. */
export function parseChatCitations(value: unknown): ChatCitation[] | null {
  if (!Array.isArray(value)) return null;
  const result: ChatCitation[] = [];
  for (const raw of value) {
    const item = asRecord(raw);
    if (!item || item.sourceType !== 'TRANSCRIPT' || typeof item.sourceId !== 'string') continue;
    if (
      typeof item.title !== 'string' ||
      typeof item.quote !== 'string' ||
      typeof item.href !== 'string'
    )
      continue;
    if (item.kind !== 'EVIDENCE' && item.kind !== 'NO_EVIDENCE' && item.kind !== 'INFERENCE')
      continue;
    const num = (key: 'fromLine' | 'toLine' | 'fromSec' | 'toSec') =>
      typeof item[key] === 'number' && Number.isFinite(item[key]) ? item[key] : null;
    result.push({
      sourceType: 'TRANSCRIPT',
      sourceId: item.sourceId,
      title: item.title,
      quote: item.quote,
      context: typeof item.context === 'string' ? item.context : null,
      fromLine: num('fromLine'),
      toLine: num('toLine'),
      fromSec: num('fromSec'),
      toSec: num('toSec'),
      href: item.href,
      kind: item.kind,
      verified: item.verified === true,
    });
  }
  return result;
}
