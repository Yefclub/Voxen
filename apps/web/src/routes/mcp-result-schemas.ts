import { z } from 'zod';
export const MCP_READ_PAGE_SCHEMA = z.object({
  dataChunk: z.string(),
  _mcp: z.object({
    truncated: z.literal(true),
    format: z.literal('application/json'),
    offset: z.number().int().min(0),
    offsetUnit: z.literal('utf16'),
    totalChars: z.number().int().positive(),
    resultChecksum: z.string().regex(/^[a-f0-9]{64}$/),
    nextCursor: z.string().max(2048).nullable(),
    instruction: z.string().max(1024),
  }),
});
export const MCP_WRITE_SUMMARY_SCHEMA = z.object({
  summary: z.record(z.string(), z.json()),
  _mcp: z.object({
    truncated: z.literal(true),
    toolExecution: z.literal('completed'),
    nextCursor: z.null(),
    followUp: z.object({
      tool: z.enum([
        'voxen_read_note',
        'voxen_read_transcript',
        'voxen_read_transcript_correction',
        'voxen_read_transcript_enrichment',
        'voxen_get_job_status',
      ]),
      arguments: z.record(z.string(), z.json()).optional(),
      jobs: z
        .array(z.object({ arguments: z.object({ job_id: z.string() }) }))
        .max(20)
        .optional(),
      instruction: z.string().max(1024).optional(),
    }),
    instruction: z.string().max(1024),
  }),
});
