/**
 * Fusão FTS + similaridade coseno (spec 104). Puro / testável.
 * Embeddings são opt-in; se não houver vetores, devolve só o rank lexical.
 */

export type HybridHit = {
  id: string;
  lexicalScore: number;
  vectorScore: number | null;
};

export type SemanticCandidate = {
  id: string;
  vector: number[];
};

export type SemanticHit = {
  id: string;
  vectorScore: number;
};

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Busca vetorial em memória para o modo opt-in sem pgvector. A seleção de
 * candidatos é limitada pelo chamador; vetores com dimensão incompatível ou
 * score baixo não entram no resgate semântico.
 */
export function rankSemanticCandidates(
  queryVector: number[],
  candidates: readonly SemanticCandidate[],
  options: { limit?: number; minScore?: number } = {},
): SemanticHit[] {
  const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? 25), 100));
  const minScore = Math.max(-1, Math.min(options.minScore ?? 0.25, 1));
  return candidates
    .map((candidate) => ({
      id: candidate.id,
      vectorScore: cosineSimilarity(queryVector, candidate.vector),
    }))
    .filter((candidate) => candidate.vectorScore >= minScore)
    .sort((a, b) => b.vectorScore - a.vectorScore || a.id.localeCompare(b.id))
    .slice(0, limit);
}

/**
 * score = (1 - alpha) * lexicalNorm + alpha * vectorNorm
 * alpha=0 → só FTS; alpha=1 → só vector.
 */
export function fuseHybridScores(
  hits: HybridHit[],
  options: { alpha?: number; missingVector?: 'lexical' | 'zero' } = {},
): Array<HybridHit & { score: number }> {
  const alpha = Math.min(1, Math.max(0, options.alpha ?? 0.35));
  const maxLex = Math.max(...hits.map((h) => h.lexicalScore), 1e-9);
  const vectorValues = hits.map((h) => h.vectorScore).filter((v): v is number => v != null);
  const maxVec = vectorValues.length ? Math.max(...vectorValues, 1e-9) : 1;

  return hits
    .map((hit) => {
      const lex = hit.lexicalScore / maxLex;
      const vec =
        hit.vectorScore == null
          ? options.missingVector === 'zero'
            ? 0
            : lex
          : Math.max(0, hit.vectorScore) / Math.max(maxVec, 1e-9);
      const score = (1 - alpha) * lex + alpha * vec;
      return { ...hit, score };
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

export function readEmbeddingFromMetadata(metadata: unknown): number[] | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const emb = (metadata as Record<string, unknown>).embedding;
  if (!emb || typeof emb !== 'object' || Array.isArray(emb)) return null;
  const vector = (emb as Record<string, unknown>).vector;
  if (!Array.isArray(vector) || vector.length < 8) return null;
  const nums = vector.map((v) => Number(v));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return nums;
}
