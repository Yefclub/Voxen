import type { InterestProjectionSnapshot } from './personal-interest-projections';
import { getPersonalInterestProjections } from './personal-interest-projections';
import {
  GRAPH_INTEREST_HORIZON_WEIGHTS,
  type GraphPersonalSeed,
  type GraphRankingPersonalization,
} from '../shared/graph-ranking';

export interface GraphPersonalizationContext extends GraphRankingPersonalization {
  seeds: GraphPersonalSeed[];
  cacheFragment: string;
}

export async function loadGraphPersonalization(
  userId: string,
): Promise<GraphPersonalizationContext> {
  try {
    return buildGraphPersonalization(await getPersonalInterestProjections({ userId }));
  } catch {
    return {
      seeds: [],
      projectionAvailable: false,
      projectionAlgorithmVersions: [],
      projectionWatermark: null,
      requestedSeedNodes: 0,
      ignoredNegativeItems: 0,
      cacheFragment: 'unavailable',
    };
  }
}

export function buildGraphPersonalization(
  snapshots: InterestProjectionSnapshot[],
): GraphPersonalizationContext {
  const seedWeights = new Map<string, number>();
  let ignoredNegativeItems = 0;
  for (const snapshot of snapshots) {
    const horizonWeight = GRAPH_INTEREST_HORIZON_WEIGHTS[snapshot.horizon];
    for (const item of snapshot.items) {
      const score = Number(item.score);
      if (!Number.isFinite(score)) continue;
      if (score < 0 || item.explicitScore < 0) ignoredNegativeItems += 1;
      if (score <= 0 || !item.brainNodeId) continue;
      seedWeights.set(
        item.brainNodeId,
        (seedWeights.get(item.brainNodeId) ?? 0) + score * horizonWeight,
      );
    }
  }
  const seeds = [...seedWeights.entries()]
    .map(([nodeId, weight]) => ({ nodeId, weight }))
    .filter((seed) => Number.isFinite(seed.weight) && seed.weight > 0)
    .sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  const projectionAlgorithmVersions = [
    ...new Set(snapshots.map((snapshot) => snapshot.algorithmVersion)),
  ].sort();
  const projectionWatermark =
    snapshots
      .map((snapshot) => snapshot.eventWatermark)
      .filter((watermark): watermark is string => watermark !== null)
      .sort()
      .at(-1) ?? null;
  return {
    seeds,
    projectionAvailable: true,
    projectionAlgorithmVersions,
    projectionWatermark,
    requestedSeedNodes: seeds.length,
    ignoredNegativeItems,
    cacheFragment: cacheFragment(projectionAlgorithmVersions, projectionWatermark),
  };
}

function cacheFragment(algorithmVersions: string[], watermark: string | null): string {
  const version = algorithmVersions.join('+').replaceAll(/[^A-Za-z0-9_.+-]/g, '_') || 'none';
  const event = (watermark ?? 'none').replaceAll(/[^A-Za-z0-9_.-]/g, '_');
  return `${version}:${event}`;
}
