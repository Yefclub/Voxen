import { z } from 'zod';

export const TRANSCRIPT_BRIEF_SCHEMA = z.object({
  transcriptId: z.string(),
  title: z.string(),
  url: z.string(),
  summary: z.string().nullable(),
  tags: z.array(z.string()),
  related: z.array(
    z.object({ id: z.string(), title: z.string(), kind: z.string(), reason: z.string() }),
  ),
  nextStep: z.string(),
});
