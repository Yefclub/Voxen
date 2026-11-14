import { diffLines } from 'diff';
import {
  readSourceEvidenceManifest,
  sourceEvidenceStamp,
  SourceProvenanceError,
  type SourceEvidenceAuthority,
} from '../source-provenance';
import type { OrganizationSource } from './source';

export type OrganizationEvidenceSpan = {
  start: number;
  end: number;
  authority: SourceEvidenceAuthority;
  originalStart?: number;
};

export function organizationRangeAuthority(
  spans: OrganizationEvidenceSpan[],
  start: number,
  end: number,
): SourceEvidenceAuthority | null {
  let cursor = start;
  let authority: SourceEvidenceAuthority | null = null;
  let previousOriginalEnd: number | null = null;
  for (const span of spans) {
    if (span.end <= cursor) continue;
    if (span.start > cursor) return null;
    const coveredEnd = Math.min(end, span.end);
    if (span.authority === 'USER_CORRECTED') authority = 'USER_CORRECTED';
    else if (!authority) authority = span.authority;
    if (span.authority === 'CAPTURED_SOURCE') {
      if (span.originalStart === undefined) return null;
      const originalStart = span.originalStart + cursor - span.start;
      if (previousOriginalEnd !== null && previousOriginalEnd !== originalStart)
        authority = 'USER_CORRECTED';
      previousOriginalEnd = originalStart + coveredEnd - cursor;
    } else previousOriginalEnd = null;
    cursor = coveredEnd;
    if (cursor === end) return authority;
  }
  return null;
}

/** Generated and audience sections never become eligible through a text edit. */
export function organizationEvidenceSpans(source: OrganizationSource): OrganizationEvidenceSpan[] {
  const stamp = sourceEvidenceStamp(source.sourceMetadata);
  if (!stamp.captured)
    return source.markdown.length
      ? [
          {
            start: 0,
            end: source.markdown.length,
            authority:
              source.correctionState === 'ACTIVE' && source.correctionRevision > 0
                ? 'USER_CORRECTED'
                : 'PREPARED_DOCUMENT',
          },
        ]
      : [];
  const canonical = source.canonicalMarkdown ?? source.markdown;
  const manifest = readSourceEvidenceManifest(canonical, stamp.manifest);
  const spans = manifest.spans.map((span) => ({
    ...span,
    authority: 'CAPTURED_SOURCE' as const,
    originalStart: span.start,
  }));
  if (canonical === source.markdown) return spans;
  if (source.correctionState !== 'ACTIVE' || source.correctionRevision <= 0)
    throw new SourceProvenanceError('SOURCE_PROVENANCE_UNAVAILABLE');
  const changes = diffLines(canonical, source.markdown, { timeout: 200, maxEditLength: 2000 });
  if (!changes) throw new SourceProvenanceError('SOURCE_MAPPING_UNAVAILABLE');
  const mapped: OrganizationEvidenceSpan[] = [];
  const append = (
    start: number,
    end: number,
    authority: SourceEvidenceAuthority,
    originalStart?: number,
  ) => {
    if (end <= start) return;
    const previous = mapped.at(-1);
    if (
      previous?.end === start &&
      previous.authority === authority &&
      (authority !== 'CAPTURED_SOURCE' ||
        (previous.originalStart !== undefined &&
          previous.originalStart + previous.end - previous.start === originalStart))
    )
      previous.end = end;
    else
      mapped.push({
        start,
        end,
        authority,
        ...(originalStart === undefined ? {} : { originalStart }),
      });
  };
  let before = 0,
    after = 0;
  for (let i = 0; i < changes.length; i++) {
    const change = changes[i]!;
    if (change.removed) {
      const removedStart = before;
      before += change.value.length;
      const replacement = changes[i + 1];
      if (replacement?.added) {
        if (spans.some((span) => removedStart >= span.start && before <= span.end))
          append(after, after + replacement.value.length, 'USER_CORRECTED');
        after += replacement.value.length;
        i++;
      }
    } else if (change.added) {
      if (spans.some((span) => before >= span.start && before < span.end))
        append(after, after + change.value.length, 'USER_CORRECTED');
      after += change.value.length;
    } else {
      for (const span of spans) {
        const start = Math.max(before, span.start),
          end = Math.min(before + change.value.length, span.end);
        if (end > start)
          append(after + start - before, after + end - before, span.authority, start);
      }
      before += change.value.length;
      after += change.value.length;
    }
  }
  return mapped;
}
