export type GraphCommunityMethod = 'leiden' | 'connected-components';

export interface GraphCommunity {
  id: number;
  size: number;
  label: string;
  nodeIds: string[];
  representativeNodeId: string;
  internalWeight: number;
  boundaryWeight: number;
  cohesion: number;
}

export interface GraphCommunityDetection {
  method: GraphCommunityMethod;
  algorithmVersion: string;
  objective: 'modularity';
  resolution: number;
  seed: number;
  quality: number | null;
  eligibleNodes: number;
  eligibleEdges: number;
  singletonNodes: number;
  fallbackReason: 'detector-error' | null;
}

export interface GraphCommunityResult {
  communities: GraphCommunity[];
  detection: GraphCommunityDetection;
}
