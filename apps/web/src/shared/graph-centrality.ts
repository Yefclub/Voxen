export type GraphPersonalizationMode = 'durable-interest' | 'uniform';

export interface GraphCentralityNodeScore {
  id: string;
  degree: number;
  weightedDegree: number;
  weightedDegreeCentrality: number;
  pageRank: number;
  personalizedPageRank: number;
  personalizationLift: number;
}

export interface GraphCentralityMetadata {
  algorithmVersion: string;
  dampingFactor: number;
  tolerance: number;
  maxIterations: number;
  structuralIterations: number;
  personalizedIterations: number;
  structuralConverged: boolean;
  personalizedConverged: boolean;
  personalizationMode: GraphPersonalizationMode;
  requestedSeedNodes: number;
  matchedSeedNodes: number;
  ignoredNegativeItems: number;
  projectionAvailable: boolean;
  projectionAlgorithmVersions: string[];
  projectionWatermark: string | null;
  horizonWeights: Record<'SHORT' | 'MEDIUM' | 'LONG', number>;
  snapshotTruncated: boolean;
}

export interface GraphCentralityResult {
  nodes: GraphCentralityNodeScore[];
  metadata: GraphCentralityMetadata;
}
