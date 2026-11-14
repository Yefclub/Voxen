import { createHash } from 'node:crypto';
import { z } from 'zod';

export const SourceEvidenceManifestSchema = z
  .object({
    version: z.literal(1),
    canonicalChecksum: z.string().regex(/^[a-f0-9]{64}$/),
    spans: z
      .array(
        z
          .object({ start: z.number().int().nonnegative(), end: z.number().int().positive() })
          .strict(),
      )
      .max(128),
  })
  .strict();
export type SourceEvidenceManifest = z.infer<typeof SourceEvidenceManifestSchema>;
export type SourceEvidenceSpan = SourceEvidenceManifest['spans'][number];
export type { SourceEvidenceAuthority } from '../shared/source-evidence';

export class SourceProvenanceError extends Error {
  constructor(readonly code: 'SOURCE_PROVENANCE_UNAVAILABLE' | 'SOURCE_MAPPING_UNAVAILABLE') {
    super(code);
    this.name = 'SourceProvenanceError';
  }
}

export const sourceEvidenceChecksum = (markdown: string) =>
  createHash('sha256').update(markdown).digest('hex');

export function sourceEvidenceStamp(metadata: unknown) {
  const data =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  const manifest = SourceEvidenceManifestSchema.safeParse(data.evidenceManifest);
  return {
    captured: data.producer === 'voxen-capture',
    manifest: manifest.success ? manifest.data : null,
  };
}

export function readSourceEvidenceManifest(
  markdown: string,
  value: unknown,
): SourceEvidenceManifest {
  const result = SourceEvidenceManifestSchema.safeParse(value);
  if (!result.success || result.data.canonicalChecksum !== sourceEvidenceChecksum(markdown))
    throw new SourceProvenanceError('SOURCE_PROVENANCE_UNAVAILABLE');
  let previousEnd = 0;
  const boundary = (offset: number) =>
    !(
      offset > 0 &&
      offset < markdown.length &&
      /[\uD800-\uDBFF]/.test(markdown[offset - 1]!) &&
      /[\uDC00-\uDFFF]/.test(markdown[offset]!)
    );
  for (const span of result.data.spans) {
    if (
      span.start < previousEnd ||
      span.end <= span.start ||
      span.end > markdown.length ||
      !boundary(span.start) ||
      !boundary(span.end)
    )
      throw new SourceProvenanceError('SOURCE_PROVENANCE_UNAVAILABLE');
    previousEnd = span.end;
  }
  return result.data;
}

export function createSourceEvidenceManifest(
  markdown: string,
  spans: SourceEvidenceSpan[],
): SourceEvidenceManifest {
  return readSourceEvidenceManifest(markdown, {
    version: 1,
    canonicalChecksum: sourceEvidenceChecksum(markdown),
    spans,
  });
}
