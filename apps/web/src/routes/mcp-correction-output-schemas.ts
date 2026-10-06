import { z } from 'zod';
const head = {
  transcriptId: z.string(),
  revision: z.number().int(),
  checksum: z.string(),
  sourceVersion: z.number().int(),
  sourceChecksum: z.string().nullable(),
};
const preview = z.object({
  matchCount: z.number().int(),
  line: z.number().int(),
  before: z.string(),
  after: z.string(),
  context: z.string(),
});
const receipt = z.object({
  ...head,
  state: z.string(),
  markdown: z.string(),
  plainText: z.string(),
});
const revision = z.object({
  revision: z.number().int(),
  sourceVersion: z.number().int(),
  sourceChecksum: z.string().nullable(),
  checksum: z.string(),
  actor: z.string(),
  changeSummary: z.string().nullable(),
  createdAt: z.string(),
});
export const MCP_CORRECTION_OUTPUT_SHAPES = {
  voxen_search_transcript_content: {
    ...head,
    matches: z.array(
      z.object({
        occurrence: z.number().int(),
        start: z.number().int(),
        end: z.number().int(),
        line: z.number().int(),
        matchedText: z.string(),
        context: z.string(),
        contextStart: z.number().int(),
        contextEnd: z.number().int(),
      }),
    ),
  },
  voxen_list_transcript_corrections: {
    revisions: z.array(revision),
    nextBefore: z.number().int().nullable(),
  },
  voxen_read_transcript_correction: {
    ...revision.shape,
    id: z.string(),
    userId: z.string(),
    transcriptId: z.string(),
    markdown: z.string(),
    plainText: z.string(),
    operation: z.json(),
  },
  voxen_patch_transcript: {
    applied: z.boolean(),
    preview,
    correction: receipt.optional(),
    graphSync: z.string().optional(),
    resultChecksum: z.string().optional(),
    transcriptId: z.string().optional(),
    revision: z.number().int().optional(),
    checksum: z.string().optional(),
    sourceVersion: z.number().int().optional(),
    sourceChecksum: z.string().nullable().optional(),
  },
  voxen_restore_transcript_correction: {
    correction: receipt,
    restoredFromRevision: z.number().int(),
    graphSync: z.string(),
  },
};
