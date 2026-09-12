import type { GraphNode } from './graph-model';

export function graphFocusFromSearch(search = window.location.search): string | null {
  const focus = new URLSearchParams(search).get('focus')?.trim();
  return focus ? focus.slice(0, 160) : null;
}

export function nodePath(node: GraphNode): string | null {
  if (!node.sourceId) return null;
  if (node.sourceType === 'TRANSCRIPT') return `/transcricoes/${node.sourceId}`;
  if (node.sourceType === 'NOTE') return `/notas/${node.sourceId}`;
  if (node.sourceType === 'EXTERNAL_ENRICHMENT' && node.transcriptId) {
    return `/transcricoes/${node.transcriptId}#additional-context-${node.sourceId}`;
  }
  return null;
}
