import { db } from './db';
import { detectGraphCommunities } from './graph-community-detection';
import { buildGraphPersonalization } from './graph-personalization';
import { readGraphSlice } from './graph-read-model';
import { buildPersonalGuide, type PersonalGuide, type PersonalGuideSource } from './personal-guide';
import { getPersonalInterestProjections } from './personal-interest-projections';
import { calculateGraphCentrality } from '../shared/graph-ranking';

export async function loadPersonalGuide(userId: string, now = new Date()): Promise<PersonalGuide> {
  const [projections, graph] = await Promise.all([
    getPersonalInterestProjections({ userId, now }),
    readGraphSlice({ userId, view: 'full', hops: 1 }),
  ]);
  const personalization = buildGraphPersonalization(projections);
  const centrality = calculateGraphCentrality({
    nodes: graph.nodes,
    edges: graph.edges,
    personalSeeds: personalization.seeds,
    personalization,
    snapshotTruncated: graph.truncated,
  });
  const communities = detectGraphCommunities(graph.nodes, graph.edges).communities;
  const requestedTranscriptIds = new Set(
    graph.nodes
      .map((node) => (node.sourceType === 'TRANSCRIPT' ? node.sourceId : null))
      .filter((transcriptId): transcriptId is string => Boolean(transcriptId)),
  );
  for (const projection of projections) {
    for (const item of projection.items) {
      for (const transcriptId of item.evidence.transcriptIds) {
        requestedTranscriptIds.add(transcriptId);
      }
    }
  }
  const sourcesByTranscriptId = await loadPersonalGuideSources(userId, [...requestedTranscriptIds]);
  return buildPersonalGuide({
    projections,
    graph,
    centrality,
    communities,
    sourcesByTranscriptId,
    now,
  });
}

export async function loadPersonalGuideSources(
  userId: string,
  transcriptIds: string[],
): Promise<Map<string, PersonalGuideSource>> {
  const uniqueIds = [...new Set(transcriptIds)].filter(Boolean).slice(0, 550);
  if (uniqueIds.length === 0) return new Map();
  const transcripts = await db.transcript.findMany({
    where: { id: { in: uniqueIds }, userId, status: 'ACTIVE' },
    select: {
      id: true,
      title: true,
      summaryMd: true,
      source: true,
      thumbnailUrl: true,
      createdAt: true,
    },
  });
  return new Map(
    transcripts.map((transcript) => [
      transcript.id,
      {
        transcriptId: transcript.id,
        title: transcript.title,
        description: conciseDescription(transcript.summaryMd),
        source: transcript.source,
        thumbnailUrl: transcript.thumbnailUrl,
        createdAt: transcript.createdAt.toISOString(),
      },
    ]),
  );
}

function conciseDescription(markdown: string | null): string | null {
  if (!markdown) return null;
  const text = markdown
    .replaceAll(/```[\s\S]*?```/g, ' ')
    .replaceAll(/[#>*_`~[\]()!-]/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, 280) : null;
}
