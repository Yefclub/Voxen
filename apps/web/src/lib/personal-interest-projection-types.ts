import type { InterestEventKind } from '../../prisma-generated/client';
import { z } from 'zod';

export type InterestProjectionHorizon = 'SHORT' | 'MEDIUM' | 'LONG';
export type InterestProjectionDimension =
  | 'TOPIC'
  | 'ENTITY'
  | 'TAG'
  | 'FOLDER'
  | 'AUTHOR'
  | 'CHANNEL'
  | 'SOURCE';

export interface InterestProjectionFeature {
  dimension: InterestProjectionDimension;
  key: string;
  label: string;
  relevance: number;
  brainNodeId?: string;
}

export interface InterestProjectionEvent {
  transcriptId: string;
  origin: 'OBSERVED' | 'EXPLICIT';
  kind: InterestEventKind;
  signal: number;
  occurredAt: Date;
}

export interface InterestProjectionItem {
  dimension: InterestProjectionDimension;
  key: string;
  label: string;
  brainNodeId: string | null;
  explicitScore: number;
  inferredScore: number;
  score: number;
  evidence: {
    observedEvents: number;
    explicitTranscripts: number;
    transcriptIds: string[];
  };
  lastEventAt: string;
}

export interface InterestProjectionSnapshot {
  horizon: InterestProjectionHorizon;
  algorithmVersion: string;
  windowDays: number;
  halfLifeDays: number;
  items: InterestProjectionItem[];
  eventCount: number;
  eventWatermark: string | null;
  computedAt: string;
}

export const InterestProjectionItemSchema = z.object({
  dimension: z.enum(['TOPIC', 'ENTITY', 'TAG', 'FOLDER', 'AUTHOR', 'CHANNEL', 'SOURCE']),
  key: z.string().min(1).max(200),
  label: z.string().min(1).max(500),
  brainNodeId: z.string().nullable(),
  explicitScore: z.number().min(-1).max(1),
  inferredScore: z.number().min(0).max(1),
  score: z.number().min(-1).max(1),
  evidence: z.object({
    observedEvents: z.number().int().nonnegative(),
    explicitTranscripts: z.number().int().nonnegative(),
    transcriptIds: z.array(z.string()).max(5),
  }),
  lastEventAt: z.string().datetime(),
});
