import type { ChatCitation } from '../../shared/chat-citations';

/** O resumo conta fontes, não repetições da mesma transcrição na resposta. */
export function countCitationSources(citations: readonly Pick<ChatCitation, 'sourceId'>[]): number {
  return new Set(citations.map((citation) => citation.sourceId)).size;
}
