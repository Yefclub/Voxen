import { z } from 'zod';
const line = z.object({ n: z.number().int(), text: z.string() });
const section = z.object({
  index: z.number().int(),
  heading: z.string(),
  level: z.number().int(),
  startLine: z.number().int(),
  lineCount: z.number().int(),
  startSec: z.number().nullable(),
  startTs: z.string().nullable(),
});
const document = {
  id: z.string(),
  title: z.string(),
  correctionRevision: z.number().int(),
  sourceVersion: z.number().int(),
};
const enclosingSection = z
  .object({
    index: z.number().int(),
    heading: z.string(),
    level: z.number().int(),
    startLine: z.number().int(),
  })
  .nullable()
  .describe(
    'Seção que contém o trecho (índice navegável em voxen_read_section); null sem headings.',
  );
export const MCP_READING_OUTPUT_SHAPES = {
  voxen_outline: { ...document, totalLines: z.number().int(), sections: z.array(section) },
  voxen_read_lines: {
    ...document,
    totalLines: z.number().int(),
    from: z.number().int(),
    to: z.number().int(),
    truncated: z.boolean(),
    lines: z.array(line),
    section: enclosingSection,
  },
  voxen_read_section: { ...document, section, truncated: z.boolean(), lines: z.array(line) },
  voxen_read_timespan: {
    ...document,
    fromSec: z.number(),
    toSec: z.number(),
    truncated: z.boolean(),
    lines: z.array(line),
    section: enclosingSection,
  },
  voxen_expand_context: {
    ...document,
    anchorLine: z.number().int(),
    from: z.number().int(),
    to: z.number().int(),
    lines: z.array(line),
    section: enclosingSection,
  },
  voxen_related: {
    results: z.array(
      z
        .object({ id: z.string(), title: z.string(), kind: z.string(), reason: z.string() })
        .passthrough(),
    ),
  },
  voxen_verify_citations: {
    results: z.array(
      z.object({
        transcriptId: z.string(),
        supported: z.boolean(),
        foundText: z.string().optional(),
        region: z.object({ from: z.number(), to: z.number() }).nullable().optional(),
        error: z.string().optional(),
      }),
    ),
  },
};
