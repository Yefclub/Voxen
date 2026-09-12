import { z } from 'zod';

export const TranscriptPatchOperationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.enum(['replace', 'insert_before', 'insert_after']),
    target: z.string().min(1).max(250_000),
    text: z.string().min(1).max(500_000),
    occurrence: z.number().int().min(1).max(100_000).optional(),
  }),
  z.object({ kind: z.enum(['prepend', 'append']), text: z.string().min(1).max(500_000) }),
]);

export const TranscriptCorrectionPreviewSchema = z.object({
  expectedRevision: z.number().int().min(0),
  expectedSourceVersion: z.number().int().min(0),
  expectedSourceChecksum: z.string().max(256).nullable(),
  operation: TranscriptPatchOperationSchema,
});

export const TranscriptCorrectionApplySchema = TranscriptCorrectionPreviewSchema.extend({
  expectedBaseChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  expectedResultChecksum: z.string().regex(/^[a-f0-9]{64}$/),
});

export const TranscriptCorrectionRestoreSchema = z.object({
  expectedRevision: z.number().int().min(0),
  expectedSourceVersion: z.number().int().min(0),
  expectedSourceChecksum: z.string().max(256).nullable(),
  expectedBaseChecksum: z.string().regex(/^[a-f0-9]{64}$/),
});
