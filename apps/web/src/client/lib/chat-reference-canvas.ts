import type { ChatCitation } from '../../shared/chat-citations';

export type CitationCanvasState = 'verified' | 'unverified' | 'stale';

export function citationCanvasKey(citation: ChatCitation): string {
  return [
    citation.sourceId,
    citation.fromLine ?? '',
    citation.toLine ?? '',
    citation.fromSec ?? '',
    citation.toSec ?? '',
  ].join(':');
}

export function citationCanvasState(citation: ChatCitation): CitationCanvasState {
  if (citation.stale) return 'stale';
  return citation.verified && citation.kind === 'EVIDENCE' ? 'verified' : 'unverified';
}
