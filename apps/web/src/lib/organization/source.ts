import { createHash } from 'node:crypto';
import { sourceSections } from '../source-sections';
import {
  sourceEvidenceStamp,
  SourceProvenanceError,
  type SourceEvidenceAuthority,
} from '../source-provenance';
import {
  organizationEvidenceSpans,
  organizationRangeAuthority,
  type OrganizationEvidenceSpan,
} from './provenance';

export class OrganizationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'OrganizationError';
  }
}

export type OrganizationSource = {
  id: string;
  userId: string;
  title: string;
  sourceVersion: number;
  sourceChecksum: string | null;
  correctionRevision: number;
  correctionState: 'ACTIVE' | 'STALE';
  correctedChecksum: string | null;
  markdown: string;
  canonicalMarkdown: string | null;
  sourceMetadata: unknown;
};
export type OrganizationEvidence = {
  excerpt: string;
  startOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
  authority: SourceEvidenceAuthority;
};
export type OrganizationSection = {
  key: string;
  text: string;
  offset: number;
  startLine: number;
  endLine: number;
  authority: SourceEvidenceAuthority | 'MIXED';
  spans: OrganizationEvidenceSpan[];
};
export const organizationHash = (value: string) => createHash('sha256').update(value).digest('hex');

export function organizationSnapshot(source: OrganizationSource) {
  const stamp = sourceEvidenceStamp(source.sourceMetadata);
  return {
    title: source.title,
    sourceVersion: source.sourceVersion,
    sourceChecksum: source.sourceChecksum,
    correctionRevision: source.correctionRevision,
    correctionState: source.correctionState,
    correctedChecksum: source.correctedChecksum,
    bodyChecksum: organizationHash(source.markdown),
    canonicalChecksum: organizationHash(source.canonicalMarkdown ?? source.markdown),
    capturedSource: stamp.captured,
    manifestChecksum: stamp.captured ? organizationHash(JSON.stringify(stamp.manifest)) : null,
  };
}

export function organizationSections(source: OrganizationSource): OrganizationSection[] {
  let spans;
  try {
    spans = organizationEvidenceSpans(source);
  } catch (error) {
    if (error instanceof SourceProvenanceError) throw new OrganizationError(error.code);
    throw error;
  }
  const parts: string[] = [];
  let cursor = 0;
  const mask = (value: string) => value.replace(/[^\n]/g, ' ');
  for (const span of spans) {
    parts.push(
      mask(source.markdown.slice(cursor, span.start)),
      source.markdown.slice(span.start, span.end),
    );
    cursor = span.end;
  }
  parts.push(mask(source.markdown.slice(cursor)));
  // Masked text keeps exact canonical offsets and cannot bridge an ineligible
  // range during quotation verification. Validate all windows before calls.
  const chunks = sourceSections(parts.join(''), { strictSectionLimit: true });
  const sections: OrganizationSection[] = [];
  let offset = 0,
    startLine = 1;
  for (const text of chunks) {
    const relevant = spans.filter((span) => span.start < offset + text.length && span.end > offset);
    const authorities = new Set(relevant.map((span) => span.authority));
    if (text.trim())
      sections.push({
        key: organizationHash(`${offset}:${text}:${JSON.stringify(relevant)}`),
        text,
        offset,
        startLine,
        endLine: startLine + (text.match(/\n/g)?.length ?? 0),
        spans: relevant,
        authority: authorities.size === 1 ? [...authorities][0]! : 'MIXED',
      });
    offset += text.length;
    startLine += text.match(/\n/g)?.length ?? 0;
  }
  return sections;
}

const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Match only source text; whitespace differences never fabricate an excerpt. */
export function organizationEvidence(
  section: OrganizationSection,
  quote: string,
): OrganizationEvidence | null {
  const pattern = quote.trim().split(/\s+/).map(escapePattern).join('\\s+');
  if (!pattern) return null;
  for (const match of section.text.matchAll(new RegExp(pattern, 'gu'))) {
    if (match[0].length > 1600) continue;
    const startOffset = section.offset + match.index,
      endOffset = startOffset + match[0].length;
    const authority = organizationRangeAuthority(section.spans, startOffset, endOffset);
    if (!authority) continue;
    const startLine =
      section.startLine + (section.text.slice(0, match.index).match(/\n/g)?.length ?? 0);
    return {
      excerpt: match[0],
      startOffset,
      endOffset,
      startLine,
      endLine: startLine + (match[0].match(/\n/g)?.length ?? 0),
      authority,
    };
  }
  return null;
}

export function organizationNameInQuote(name: string, quote: string): boolean {
  const normalize = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${escapePattern(normalize(name))}(?![\\p{L}\\p{N}])`,
    'iu',
  ).test(normalize(quote));
}
