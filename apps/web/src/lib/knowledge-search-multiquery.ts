import { searchKnowledgeBase, type KnowledgeSearchResult } from './retrieval';

export type KnowledgeSearchPlan = {
  queries: string[];
  strategy: 'reciprocal-rank-fusion';
  sourceCounts: Record<KnowledgeSearchResult['sourceType'], number>;
  semanticRescueUsed: boolean;
};

export function normalizeKnowledgeQueries(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const queries: string[] = [];
  for (const value of values) {
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
  return queries;
}

export function fuseKnowledgeQueryResults(
  resultSets: readonly (readonly KnowledgeSearchResult[])[],
  limit = 8,
): KnowledgeSearchResult[] {
  const scores = new Map<string, { item: KnowledgeSearchResult; score: number }>();
  for (const results of resultSets) {
    results.forEach((item, index) => {
      const key = `${item.sourceType}:${item.id}`;
      const current = scores.get(key);
      const score = (current?.score ?? 0) + 1 / (60 + index + 1);
      const retrievalSource = [current?.item.retrievalSource, item.retrievalSource].includes(
        'hybrid',
      )
        ? 'hybrid'
        : [current?.item.retrievalSource, item.retrievalSource].includes('semantic')
          ? 'semantic'
          : (current?.item.retrievalSource ?? item.retrievalSource);
      scores.set(key, {
        item: current ? { ...current.item, retrievalSource } : item,
        score,
      });
    });
  }
  return [...scores.values()]
    .sort((a, b) => b.score - a.score || b.item.createdAt.getTime() - a.item.createdAt.getTime())
    .slice(0, Math.min(Math.max(Math.trunc(limit), 1), 25))
    .map(({ item }) => item);
}

export async function searchKnowledgeBaseMultiQuery(
  userId: string,
  inputQueries: readonly string[],
  limit = 8,
  search: typeof searchKnowledgeBase = searchKnowledgeBase,
): Promise<{ results: KnowledgeSearchResult[]; plan: KnowledgeSearchPlan }> {
  const queries = normalizeKnowledgeQueries(inputQueries);
  const resultSets = await Promise.all(queries.map((query) => search(userId, query, limit)));
  const results = fuseKnowledgeQueryResults(resultSets, limit);
  const sourceCounts = { transcript: 0, note: 0, external_enrichment: 0 };
  for (const result of results) sourceCounts[result.sourceType]++;
  return {
    results,
    plan: {
      queries,
      strategy: 'reciprocal-rank-fusion',
      sourceCounts,
      semanticRescueUsed: results.some(
        (item) => item.retrievalSource === 'semantic' || item.retrievalSource === 'hybrid',
      ),
    },
  };
}
