import { createHash } from 'node:crypto';
import { sourceSections } from '../source-sections';

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
};
export type OrganizationEvidence = {
  excerpt: string;
  startOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
};
export type OrganizationSection = {
  key: string;
  text: string;
  offset: number;
  startLine: number;
  endLine: number;
};
export const organizationHash = (value: string) => createHash('sha256').update(value).digest('hex');

export function organizationSnapshot(source: OrganizationSource) {
  return {
    title: source.title,
    sourceVersion: source.sourceVersion,
    sourceChecksum: source.sourceChecksum,
    correctionRevision: source.correctionRevision,
    correctionState: source.correctionState,
    correctedChecksum: source.correctedChecksum,
    bodyChecksum: organizationHash(source.markdown),
  };
}

export function organizationSections(markdown: string): OrganizationSection[] {
  let offset = 0;
  let startLine = 1;
  return sourceSections(markdown).map((text) => {
    const endLine = startLine + (text.match(/\n/g)?.length ?? 0);
    const section = {
      key: organizationHash(`${offset}:${text}`),
      text,
      offset,
      startLine,
      endLine,
    };
    offset += text.length;
    startLine = endLine;
    return section;
  });
}

const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Match only source text; whitespace differences never fabricate an excerpt. */
export function organizationEvidence(
  section: OrganizationSection,
  quote: string,
): OrganizationEvidence | null {
  const pattern = quote.trim().split(/\s+/).map(escapePattern).join('\\s+');
  if (!pattern) return null;
  const match = new RegExp(pattern, 'u').exec(section.text);
  if (!match || match[0].length > 1600) return null;
  const startLine =
    section.startLine + (section.text.slice(0, match.index).match(/\n/g)?.length ?? 0);
  return {
    excerpt: match[0],
    startOffset: section.offset + match.index,
    endOffset: section.offset + match.index + match[0].length,
    startLine,
    endLine: startLine + (match[0].match(/\n/g)?.length ?? 0),
  };
}

export function organizationNameInQuote(name: string, quote: string): boolean {
  const normalize = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${escapePattern(normalize(name))}(?![\\p{L}\\p{N}])`,
    'iu',
  ).test(normalize(quote));
}
