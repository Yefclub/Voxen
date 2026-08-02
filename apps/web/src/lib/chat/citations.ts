import { db } from '../db';
import type { StoredToolEvent } from './runtime';
import type { ChatCitation } from '../../shared/chat-citations';

type CitationClaim = {
  transcriptId: string;
  quote: string;
  fromLine?: number;
  toLine?: number;
  fromSec?: number;
  toSec?: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asClaim(value: unknown): CitationClaim | null {
  const record = asRecord(value);
  if (!record || typeof record.transcriptId !== 'string' || typeof record.quote !== 'string')
    return null;
  const number = (key: 'fromLine' | 'toLine' | 'fromSec' | 'toSec'): number | undefined =>
    typeof record[key] === 'number' && Number.isFinite(record[key]) ? record[key] : undefined;
  const quote = record.quote.trim();
  if (!quote) return null;
  return {
    transcriptId: record.transcriptId,
    quote,
    fromLine: number('fromLine'),
    toLine: number('toLine'),
    fromSec: number('fromSec'),
    toSec: number('toSec'),
  };
}

/**
 * Converte somente a saída determinística de `verify_citations` em evidência
 * de produto. Texto livre do modelo não ganha selo de citação verificada.
 */
export async function citationsFromToolEvents(
  userId: string,
  events: readonly StoredToolEvent[],
): Promise<ChatCitation[]> {
  const candidates: Array<{ claim: CitationClaim; result: Record<string, unknown> }> = [];
  for (const event of events) {
    if (event.name !== 'verify_citations' || event.state !== 'completed') continue;
    const input = asRecord(event.input);
    const output = asRecord(event.output);
    const claims = Array.isArray(input?.claims)
      ? input.claims.map(asClaim).filter((claim): claim is CitationClaim => claim !== null)
      : [];
    const results = Array.isArray(output?.results)
      ? output.results
          .map(asRecord)
          .filter((result): result is Record<string, unknown> => result !== null)
      : [];
    for (const result of results) {
      const transcriptId = typeof result.transcriptId === 'string' ? result.transcriptId : null;
      if (!transcriptId) continue;
      const claim = claims.find((item) => item.transcriptId === transcriptId);
      if (claim) candidates.push({ claim, result });
    }
  }
  const ids = [...new Set(candidates.map(({ claim }) => claim.transcriptId))];
  if (ids.length === 0) return [];
  const sources = await db.transcript.findMany({
    where: { id: { in: ids }, userId, status: 'ACTIVE' },
    select: { id: true, title: true },
  });
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const seen = new Set<string>();
  const citations: ChatCitation[] = [];
  for (const { claim, result } of candidates) {
    const source = sourceById.get(claim.transcriptId);
    if (!source) continue; // não serializa referência de outro workspace
    const supported = result.supported === true;
    const region = asRecord(result.region);
    const fromLine = typeof region?.from === 'number' ? region.from : (claim.fromLine ?? null);
    const toLine = typeof region?.to === 'number' ? region.to : (claim.toLine ?? null);
    const fromSec = claim.fromSec ?? null;
    const toSec = claim.toSec ?? null;
    const key = `${source.id}:${claim.quote}:${fromLine ?? ''}:${fromSec ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const anchor = fromSec ?? toSec;
    citations.push({
      sourceType: 'TRANSCRIPT',
      sourceId: source.id,
      title: source.title,
      quote: claim.quote,
      context: typeof result.foundText === 'string' ? result.foundText.slice(0, 600) : null,
      fromLine,
      toLine,
      fromSec,
      toSec,
      href: `/transcricoes/${source.id}${anchor !== null ? `#t=${Math.floor(anchor)}` : fromLine ? `#l=${fromLine}` : ''}`,
      kind: supported ? 'EVIDENCE' : 'NO_EVIDENCE',
      verified: supported,
    });
  }
  return citations;
}
