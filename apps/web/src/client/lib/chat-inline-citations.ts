import type { ChatCitation } from '../../shared/chat-citations';

const INLINE_CITATION_PREFIX = '#voxen-citation-';

function isInlineEvidence(citation: ChatCitation): boolean {
  return (
    citation.verified &&
    citation.kind === 'EVIDENCE' &&
    !citation.stale &&
    citation.inlineOrdinal !== null
  );
}

export function inlineEvidence(citations: readonly ChatCitation[]): ChatCitation[] {
  return citations
    .filter(isInlineEvidence)
    .sort((left, right) => left.inlineOrdinal! - right.inlineOrdinal!);
}

export function inlineCitationHref(index: number): string {
  return `${INLINE_CITATION_PREFIX}${index}`;
}

export function citationFromInlineHref(
  href: string | undefined,
  citations: readonly ChatCitation[],
): ChatCitation | null {
  const match = new RegExp(`^${INLINE_CITATION_PREFIX}(\\d+)$`).exec(href ?? '');
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isSafeInteger(index) && index > 0
    ? (inlineEvidence(citations).find((citation) => citation.inlineOrdinal === index) ?? null)
    : null;
}

/**
 * `[[n]]` é deliberadamente uma sintaxe interna: não colide com listas
 * Markdown nem transforma um número livre do modelo em uma citação.
 */
export function renderInlineCitations(content: string, citations: readonly ChatCitation[]): string {
  const evidence = inlineEvidence(citations);
  if (evidence.length === 0) return content;
  return content.replace(/\[\[(\d+)\]\]/g, (token, value: string) => {
    const index = Number(value);
    return Number.isSafeInteger(index) && index > 0 && index <= evidence.length
      ? `[${index}](${inlineCitationHref(index)})`
      : token;
  });
}
