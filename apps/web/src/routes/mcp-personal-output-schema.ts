import { z } from 'zod';
const source = z.object({ transcriptId: z.string(), title: z.string(), href: z.string() });
const horizons = z.object({ short: z.number(), medium: z.number(), long: z.number() });
const counts = z.object({
  explicitTranscripts: z.number().int(),
  observedEvents: z.number().int(),
});
export const MCP_PERSONAL_OUTPUT_SHAPE = {
  metadata: z.object({
    algorithmVersion: z.string(),
    generatedAt: z.string(),
    projectionAlgorithmVersions: z.array(z.string()),
    projectionWatermark: z.string().nullable(),
    guideAlgorithmVersion: z.string(),
    rankingAlgorithmVersion: z.string(),
    personalizationMode: z.string(),
    graphTruncated: z.boolean(),
    contextTruncated: z.boolean(),
    empty: z.boolean(),
  }),
  preferences: z.array(
    z.object({
      dimension: z.string(),
      key: z.string(),
      label: z.string(),
      brainNodeId: z.string().nullable(),
      stance: z.enum(['MORE', 'LESS']),
      provenance: z.enum(['DECLARED', 'INFERRED', 'MIXED']),
      score: z.number(),
      declaredScore: z.number(),
      inferredScore: z.number(),
      horizonScores: horizons,
      evidenceCounts: counts,
      evidence: z.array(source),
      lastEventAt: z.string(),
    }),
  ),
  trends: z.array(
    z.object({
      dimension: z.string(),
      key: z.string(),
      label: z.string(),
      brainNodeId: z.string().nullable(),
      classification: z.enum(['EMERGING', 'STEADY', 'COOLING']),
      score: z.number(),
      horizonScores: horizons,
      evidenceCounts: counts,
      evidence: z.array(source),
    }),
  ),
  recommendations: z.array(
    z.object({
      transcriptId: z.string(),
      title: z.string(),
      href: z.string(),
      brainNodeId: z.string(),
      score: z.number(),
      structuralScore: z.number(),
      personalizedScore: z.number(),
      personalizationLift: z.number(),
      reasons: z.array(
        z.object({
          kind: z.enum(['INTEREST', 'COMMUNITY', 'PERSONALIZATION', 'STRUCTURAL']),
          label: z.string(),
          score: z.number(),
          community: z
            .object({ id: z.number(), label: z.string(), cohesion: z.number() })
            .nullable(),
          evidence: z.array(source),
        }),
      ),
    }),
  ),
};
