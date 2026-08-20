export type KnowledgeSearchDisclosure = {
  queries: string[];
  sourceCounts: { transcript: number; note: number; external_enrichment: number };
  semanticRescueUsed: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Lê somente o contrato seguro de transparência, nunca texto arbitrário da tool. */
export function parseKnowledgeSearchDisclosure(value: unknown): KnowledgeSearchDisclosure | null {
  const root = asRecord(value);
  const plan = asRecord(root?.searchPlan);
  if (!plan || !Array.isArray(plan.queries)) return null;
  const seen = new Set<string>();
  const queries: string[] = [];
  for (const value of plan.queries) {
    if (typeof value !== 'string') continue;
    const query = value.trim().replace(/\s+/g, ' ').slice(0, 300);
    const key = query
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    if (!query || seen.has(key)) continue;
    seen.add(key);
    queries.push(query);
    if (queries.length === 3) break;
  }
  const counts = asRecord(plan.sourceCounts);
  if (queries.length === 0 || !counts) return null;
  const count = (key: 'transcript' | 'note' | 'external_enrichment') =>
    typeof counts[key] === 'number' && Number.isSafeInteger(counts[key]) && counts[key] >= 0
      ? counts[key]
      : 0;
  return {
    queries,
    sourceCounts: {
      transcript: count('transcript'),
      note: count('note'),
      external_enrichment: count('external_enrichment'),
    },
    semanticRescueUsed: plan.semanticRescueUsed === true,
  };
}
