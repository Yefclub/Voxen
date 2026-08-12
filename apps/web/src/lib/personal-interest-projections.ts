import {
  Prisma,
  type InterestProjection as StoredInterestProjection,
} from '../../prisma-generated/client';
import { z } from 'zod';
import { db } from './db';
import { InterestProjectionItemSchema } from './personal-interest-projection-types';
import type {
  InterestProjectionEvent,
  InterestProjectionFeature,
  InterestProjectionHorizon,
  InterestProjectionItem,
  InterestProjectionSnapshot,
} from './personal-interest-projection-types';
export type {
  InterestProjectionDimension,
  InterestProjectionEvent,
  InterestProjectionFeature,
  InterestProjectionHorizon,
  InterestProjectionItem,
  InterestProjectionSnapshot,
} from './personal-interest-projection-types';

export const INTEREST_PROJECTION_ALGORITHM_VERSION = 'interest-v1';
export const INTEREST_PROJECTION_MAX_ITEMS = 50;
export const INTEREST_PROJECTION_FRESHNESS_MS = 15 * 60 * 1_000;

interface ProjectionConfig {
  horizon: InterestProjectionHorizon;
  windowDays: number;
  halfLifeDays: number;
}

export const INTEREST_PROJECTION_CONFIGS: readonly ProjectionConfig[] = [
  { horizon: 'SHORT', windowDays: 14, halfLifeDays: 3 },
  { horizon: 'MEDIUM', windowDays: 90, halfLifeDays: 21 },
  { horizon: 'LONG', windowDays: 365, halfLifeDays: 90 },
] as const;

interface Aggregate {
  feature: InterestProjectionFeature;
  observedRaw: number;
  explicitWeighted: number;
  explicitWeight: number;
  observedEvents: number;
  explicitTranscripts: number;
  transcriptIds: Set<string>;
  lastEventAt: Date;
}

export function calculateInterestProjections(input: {
  events: InterestProjectionEvent[];
  featuresByTranscript: Map<string, InterestProjectionFeature[]>;
  now: Date;
  eventWatermark?: Date | null;
}): InterestProjectionSnapshot[] {
  return INTEREST_PROJECTION_CONFIGS.map((config) => {
    const cutoff = new Date(input.now.getTime() - config.windowDays * 86_400_000);
    const relevantEvents = input.events.filter(
      (event) => event.origin === 'EXPLICIT' || event.occurredAt >= cutoff,
    );
    const aggregates = new Map<string, Aggregate>();

    for (const event of relevantEvents) {
      if (event.origin === 'EXPLICIT' && event.signal === 0) continue;
      const features = input.featuresByTranscript.get(event.transcriptId) ?? [];
      const ageDays = Math.max(0, (input.now.getTime() - event.occurredAt.getTime()) / 86_400_000);
      const decay = Math.exp((-Math.LN2 * ageDays) / config.halfLifeDays);
      for (const feature of features) {
        const aggregateKey = `${feature.dimension}:${feature.key}`;
        const current = aggregates.get(aggregateKey) ?? {
          feature,
          observedRaw: 0,
          explicitWeighted: 0,
          explicitWeight: 0,
          observedEvents: 0,
          explicitTranscripts: 0,
          transcriptIds: new Set<string>(),
          lastEventAt: event.occurredAt,
        };
        if (event.origin === 'OBSERVED') {
          current.observedRaw += decay * 0.15 * feature.relevance;
          current.observedEvents += 1;
        } else {
          current.explicitWeighted += event.signal * feature.relevance;
          current.explicitWeight += feature.relevance;
          current.explicitTranscripts += 1;
        }
        current.transcriptIds.add(event.transcriptId);
        if (event.occurredAt > current.lastEventAt) current.lastEventAt = event.occurredAt;
        if (!current.feature.brainNodeId && feature.brainNodeId) current.feature = feature;
        aggregates.set(aggregateKey, current);
      }
    }

    const items = [...aggregates.values()]
      .map((aggregate): InterestProjectionItem => {
        const explicitScore =
          aggregate.explicitWeight > 0
            ? clamp(aggregate.explicitWeighted / aggregate.explicitWeight, -1, 1)
            : 0;
        const inferredScore = clamp(1 - Math.exp(-aggregate.observedRaw), 0, 1);
        const score = clamp(explicitScore * 0.75 + inferredScore * 0.25, -1, 1);
        return {
          dimension: aggregate.feature.dimension,
          key: aggregate.feature.key,
          label: aggregate.feature.label,
          brainNodeId: aggregate.feature.brainNodeId ?? null,
          explicitScore: roundScore(explicitScore),
          inferredScore: roundScore(inferredScore),
          score: roundScore(score),
          evidence: {
            observedEvents: aggregate.observedEvents,
            explicitTranscripts: aggregate.explicitTranscripts,
            transcriptIds: [...aggregate.transcriptIds].sort().slice(0, 5),
          },
          lastEventAt: aggregate.lastEventAt.toISOString(),
        };
      })
      .filter((item) => Math.abs(item.score) >= 0.001 || item.explicitScore !== 0)
      .sort(
        (left, right) =>
          Math.abs(right.score) - Math.abs(left.score) ||
          right.score - left.score ||
          left.dimension.localeCompare(right.dimension) ||
          left.key.localeCompare(right.key),
      )
      .slice(0, INTEREST_PROJECTION_MAX_ITEMS);

    return {
      horizon: config.horizon,
      algorithmVersion: INTEREST_PROJECTION_ALGORITHM_VERSION,
      windowDays: config.windowDays,
      halfLifeDays: config.halfLifeDays,
      items,
      eventCount: relevantEvents.length,
      eventWatermark: input.eventWatermark?.toISOString() ?? null,
      computedAt: input.now.toISOString(),
    };
  });
}

export async function rebuildPersonalInterestProjections(
  userId: string,
  now = new Date(),
): Promise<InterestProjectionSnapshot[]> {
  const longCutoff = new Date(now.getTime() - 365 * 86_400_000);
  const [observed, explicitRows, latestEvent] = await Promise.all([
    db.interestEvent.findMany({
      where: { userId, origin: 'OBSERVED', occurredAt: { gte: longCutoff } },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      select: { transcriptId: true, origin: true, kind: true, signal: true, occurredAt: true },
    }),
    db.$queryRaw<InterestProjectionEvent[]>(Prisma.sql`
      SELECT DISTINCT ON ("transcriptId")
        "transcriptId", "origin", "kind", "signal", "occurredAt"
      FROM "InterestEvent"
      WHERE "userId" = ${userId}
        AND "origin" = 'EXPLICIT'::"InterestEventOrigin"
      ORDER BY "transcriptId", "occurredAt" DESC, "createdAt" DESC, "id" DESC
    `),
    db.interestEvent.findFirst({
      where: { userId },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      select: { occurredAt: true },
    }),
  ]);
  const events: InterestProjectionEvent[] = [...observed, ...explicitRows];
  const transcriptIds = [...new Set(events.map((event) => event.transcriptId))];
  const featuresByTranscript = await loadProjectionFeatures(userId, transcriptIds);
  const snapshots = calculateInterestProjections({
    events: events.filter((event) => featuresByTranscript.has(event.transcriptId)),
    featuresByTranscript,
    now,
    eventWatermark: latestEvent?.occurredAt ?? null,
  });

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw<Array<{ locked: boolean }>>(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0)) IS NULL AS "locked"
    `);
    const stored = await transaction.interestProjection.findMany({ where: { userId } });
    if (
      stored.length === INTEREST_PROJECTION_CONFIGS.length &&
      isStoredProjectionNewer(stored, snapshots)
    ) {
      return stored.map(serializeStoredProjection);
    }
    await Promise.all(
      snapshots.map((snapshot) =>
        transaction.interestProjection.upsert({
          where: { userId_horizon: { userId, horizon: snapshot.horizon } },
          create: {
            userId,
            horizon: snapshot.horizon,
            algorithmVersion: snapshot.algorithmVersion,
            windowDays: snapshot.windowDays,
            halfLifeDays: snapshot.halfLifeDays,
            items: snapshot.items as unknown as Prisma.InputJsonValue,
            eventCount: snapshot.eventCount,
            eventWatermark: snapshot.eventWatermark ? new Date(snapshot.eventWatermark) : null,
            computedAt: new Date(snapshot.computedAt),
          },
          update: {
            algorithmVersion: snapshot.algorithmVersion,
            windowDays: snapshot.windowDays,
            halfLifeDays: snapshot.halfLifeDays,
            items: snapshot.items as unknown as Prisma.InputJsonValue,
            eventCount: snapshot.eventCount,
            eventWatermark: snapshot.eventWatermark ? new Date(snapshot.eventWatermark) : null,
            computedAt: new Date(snapshot.computedAt),
          },
        }),
      ),
    );
    return snapshots;
  });
}

export async function getPersonalInterestProjections(input: {
  userId: string;
  now?: Date;
  force?: boolean;
}): Promise<InterestProjectionSnapshot[]> {
  const now = input.now ?? new Date();
  const [stored, latestEvent] = await Promise.all([
    db.interestProjection.findMany({
      where: { userId: input.userId },
      orderBy: { horizon: 'asc' },
    }),
    db.interestEvent.findFirst({
      where: { userId: input.userId },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      select: { occurredAt: true },
    }),
  ]);
  const stale =
    input.force === true ||
    stored.length !== INTEREST_PROJECTION_CONFIGS.length ||
    stored.some(
      (projection) =>
        projection.algorithmVersion !== INTEREST_PROJECTION_ALGORITHM_VERSION ||
        now.getTime() - projection.computedAt.getTime() > INTEREST_PROJECTION_FRESHNESS_MS ||
        (latestEvent !== null &&
          (projection.eventWatermark === null ||
            projection.eventWatermark.getTime() < latestEvent.occurredAt.getTime())),
    );
  if (stale) return rebuildPersonalInterestProjections(input.userId, now);
  return stored.map(serializeStoredProjection);
}

function serializeStoredProjection(
  projection: StoredInterestProjection,
): InterestProjectionSnapshot {
  return {
    horizon: projection.horizon,
    algorithmVersion: projection.algorithmVersion,
    windowDays: projection.windowDays,
    halfLifeDays: projection.halfLifeDays,
    items: parseProjectionItems(projection.items),
    eventCount: projection.eventCount,
    eventWatermark: projection.eventWatermark?.toISOString() ?? null,
    computedAt: projection.computedAt.toISOString(),
  };
}

function isStoredProjectionNewer(
  stored: StoredInterestProjection[],
  candidates: InterestProjectionSnapshot[],
): boolean {
  const candidateByHorizon = new Map(candidates.map((candidate) => [candidate.horizon, candidate]));
  return stored.every((projection) => {
    const candidate = candidateByHorizon.get(projection.horizon);
    if (!candidate) return true;
    const storedWatermark = projection.eventWatermark?.getTime() ?? Number.NEGATIVE_INFINITY;
    const candidateWatermark = candidate.eventWatermark
      ? new Date(candidate.eventWatermark).getTime()
      : Number.NEGATIVE_INFINITY;
    return (
      storedWatermark > candidateWatermark ||
      (storedWatermark === candidateWatermark &&
        projection.computedAt.getTime() > new Date(candidate.computedAt).getTime())
    );
  });
}

export async function loadProjectionFeatures(
  userId: string,
  transcriptIds: string[],
  activeOnly = false,
): Promise<Map<string, InterestProjectionFeature[]>> {
  if (transcriptIds.length === 0) return new Map();
  const [transcripts, contentNodes] = await Promise.all([
    db.transcript.findMany({
      where: {
        id: { in: transcriptIds },
        userId,
        status: activeOnly ? 'ACTIVE' : { not: 'TRASH' },
      },
      select: {
        id: true,
        source: true,
        author: true,
        channel: true,
        folder: { select: { id: true, userId: true, name: true } },
        tags: { select: { tag: { select: { userId: true, slug: true, name: true } } } },
      },
    }),
    db.brainNode.findMany({
      where: {
        userId,
        sourceType: 'TRANSCRIPT',
        sourceId: { in: transcriptIds },
        status: activeOnly ? 'ACTIVE' : { not: 'TRASH' },
      },
      select: {
        sourceId: true,
        outgoing: {
          where: {
            userId,
            status: activeOnly ? 'ACTIVE' : { not: 'TRASH' },
            to: {
              userId,
              status: activeOnly ? 'ACTIVE' : { not: 'TRASH' },
              type: { in: ['TOPIC', 'ENTITY'] },
            },
          },
          select: {
            confidence: true,
            to: { select: { id: true, key: true, label: true, type: true } },
          },
        },
        incoming: {
          where: {
            userId,
            status: activeOnly ? 'ACTIVE' : { not: 'TRASH' },
            from: {
              userId,
              status: activeOnly ? 'ACTIVE' : { not: 'TRASH' },
              type: { in: ['TOPIC', 'ENTITY'] },
            },
          },
          select: {
            confidence: true,
            from: { select: { id: true, key: true, label: true, type: true } },
          },
        },
      },
    }),
  ]);
  const featuresByTranscript = new Map<string, Map<string, InterestProjectionFeature>>();
  for (const transcript of transcripts) {
    const features = new Map<string, InterestProjectionFeature>();
    addFeature(features, {
      dimension: 'SOURCE',
      key: transcript.source.toLowerCase(),
      label: transcript.source,
      relevance: 0.4,
    });
    if (transcript.author?.trim()) {
      addFeature(features, {
        dimension: 'AUTHOR',
        key: normalizeFeatureKey(transcript.author),
        label: transcript.author.trim(),
        relevance: 0.8,
      });
    }
    if (transcript.channel?.trim()) {
      addFeature(features, {
        dimension: 'CHANNEL',
        key: normalizeFeatureKey(transcript.channel),
        label: transcript.channel.trim(),
        relevance: 0.8,
      });
    }
    if (transcript.folder?.userId === userId) {
      addFeature(features, {
        dimension: 'FOLDER',
        key: transcript.folder.id,
        label: transcript.folder.name,
        relevance: 0.7,
      });
    }
    for (const relation of transcript.tags) {
      if (relation.tag.userId !== userId) continue;
      addFeature(features, {
        dimension: 'TAG',
        key: relation.tag.slug,
        label: relation.tag.name,
        relevance: 1,
      });
    }
    featuresByTranscript.set(transcript.id, features);
  }
  for (const contentNode of contentNodes) {
    if (!contentNode.sourceId) continue;
    const features = featuresByTranscript.get(contentNode.sourceId);
    if (!features) continue;
    for (const relation of [...contentNode.outgoing, ...contentNode.incoming]) {
      const node = 'to' in relation ? relation.to : relation.from;
      addFeature(features, {
        dimension: node.type === 'TOPIC' ? 'TOPIC' : 'ENTITY',
        key: node.key,
        label: node.label,
        relevance: clamp(Number(relation.confidence), 0.2, 1),
        brainNodeId: node.id,
      });
    }
  }
  return new Map(
    [...featuresByTranscript.entries()].map(([transcriptId, features]) => [
      transcriptId,
      [...features.values()],
    ]),
  );
}

function addFeature(
  features: Map<string, InterestProjectionFeature>,
  feature: InterestProjectionFeature,
): void {
  if (!feature.key || !feature.label) return;
  const id = `${feature.dimension}:${feature.key}`;
  const current = features.get(id);
  if (
    !current ||
    feature.relevance > current.relevance ||
    (!current.brainNodeId && feature.brainNodeId)
  ) {
    features.set(id, feature);
  }
}

export function normalizeFeatureKey(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/(\p{Script=Latin})\p{M}+/gu, '$1')
    .normalize('NFC')
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function parseProjectionItems(value: Prisma.JsonValue): InterestProjectionItem[] {
  if (!Array.isArray(value)) return [];
  const parsed = z.array(InterestProjectionItemSchema).safeParse(value);
  return parsed.success ? parsed.data.slice(0, INTEREST_PROJECTION_MAX_ITEMS) : [];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundScore(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
