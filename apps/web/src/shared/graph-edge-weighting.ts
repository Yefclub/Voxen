export interface GraphWeightEdge {
  from: string;
  to: string;
  kind: string;
  confidence: string | number;
  evidence?: string;
}

export interface WeightedGraphEdge {
  from: string;
  to: string;
  weight: number;
}

const EVIDENCE_FACTORS: Readonly<Record<string, number>> = {
  EXTRACTED: 1,
  INFERRED: 0.65,
  AMBIGUOUS: 0.4,
};

const KIND_FACTORS: Readonly<Record<string, number>> = {
  same_as: 1.15,
  belongs_to: 1.1,
  part_of: 1.1,
  supports: 1,
  mentions: 0.9,
  links_to: 0.85,
  related_to: 0.7,
  next_to: 0.45,
  contradicts: 0.35,
};

export function effectiveGraphEdgeWeight(edge: GraphWeightEdge): number {
  const parsedConfidence = Number(edge.confidence);
  const confidence = Number.isFinite(parsedConfidence) ? clamp(parsedConfidence, 0, 1) : 0.5;
  const evidenceFactor =
    EVIDENCE_FACTORS[edge.evidence ?? 'AMBIGUOUS'] ?? EVIDENCE_FACTORS.AMBIGUOUS!;
  const kindFactor = KIND_FACTORS[edge.kind.toLowerCase()] ?? 0.5;
  const weighted = confidence * evidenceFactor * kindFactor;
  return Number.isFinite(weighted) ? roundGraphScore(clamp(weighted, 0, 1)) : 0;
}

export function aggregateWeightedUndirectedEdges(
  nodeIds: ReadonlySet<string>,
  edges: GraphWeightEdge[],
): WeightedGraphEdge[] {
  const pairs = new Map<string, WeightedGraphEdge>();
  for (const edge of edges) {
    if (edge.from === edge.to || !nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue;
    const weight = effectiveGraphEdgeWeight(edge);
    if (weight <= 0) continue;
    const [from, to] = edge.from < edge.to ? [edge.from, edge.to] : [edge.to, edge.from];
    const key = `${from}\u0000${to}`;
    const current = pairs.get(key);
    pairs.set(key, {
      from,
      to,
      weight: roundGraphScore(1 - (1 - (current?.weight ?? 0)) * (1 - weight)),
    });
  }
  return [...pairs.values()].sort(
    (left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to),
  );
}

export function roundGraphScore(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
