import { createHash } from 'node:crypto';
import type { SourceEvidenceAuthority } from '../../shared/source-evidence';
import { SOURCE_EVIDENCE_AUTHORITIES } from '../../shared/source-evidence';
import { parseLineTimestamp } from '../retrieval';

export type PassageKind = 'ORIGINAL' | 'SOURCE_DERIVED' | 'EXTERNAL_ACCEPTED';
export type PassageRegion = {
  start: number;
  end: number;
  kind: PassageKind;
  authority: SourceEvidenceAuthority | null;
};
export type PassageSource = {
  userId: string;
  type: 'transcript' | 'note' | 'external_enrichment';
  id: string;
  revision: string;
  title: string;
  text: string;
  regions: PassageRegion[];
};
export type Passage = {
  key: string;
  checksum: string;
  text: string;
  kind: PassageKind;
  authority: SourceEvidenceAuthority | null;
  section: string | null;
  startOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
  startSec: number | null;
  endSec: number | null;
};

export class PassageBuildError extends Error {
  constructor(readonly code: 'INDEX_CAPACITY' | 'INVALID_SOURCE' | 'INVALID_PROVENANCE') {
    super(code);
    this.name = 'PassageBuildError';
  }
}

const WINDOW = 4000;
const OVERLAP = 240;
const MAX_SOURCE = 4_000_000;
const MAX_PASSAGES = 4096;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const high = (value: number) => value >= 0xd800 && value <= 0xdbff;
const low = (value: number) => value >= 0xdc00 && value <= 0xdfff;
const splitsPair = (text: string, offset: number) =>
  low(text.charCodeAt(offset)) && high(text.charCodeAt(offset - 1));

function validate(source: PassageSource) {
  if (
    !['transcript', 'note', 'external_enrichment'].includes(source.type) ||
    [source.userId, source.id, source.revision].some((value) => !value || value.length > 256) ||
    !source.title ||
    source.title.length > 1000
  )
    throw new PassageBuildError('INVALID_SOURCE');
  if (source.text.length > MAX_SOURCE || source.regions.length > MAX_PASSAGES)
    throw new PassageBuildError('INDEX_CAPACITY');
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(source.text))
    throw new PassageBuildError('INVALID_SOURCE');
  let cursor = 0;
  for (const region of source.regions) {
    const original = region.kind === 'ORIGINAL';
    const validAuthority =
      source.type === 'note'
        ? region.authority === null
        : region.authority !== null && SOURCE_EVIDENCE_AUTHORITIES.includes(region.authority);
    if (
      !Number.isInteger(region.start) ||
      !Number.isInteger(region.end) ||
      region.start !== cursor ||
      region.end <= region.start ||
      region.end > source.text.length ||
      splitsPair(source.text, region.start) ||
      splitsPair(source.text, region.end) ||
      !['ORIGINAL', 'SOURCE_DERIVED', 'EXTERNAL_ACCEPTED'].includes(region.kind) ||
      (source.type === 'external_enrichment'
        ? region.kind !== 'EXTERNAL_ACCEPTED' || region.authority !== null
        : region.kind === 'EXTERNAL_ACCEPTED' ||
          (original ? !validAuthority : region.authority !== null))
    )
      throw new PassageBuildError('INVALID_PROVENANCE');
    cursor = region.end;
  }
  if (cursor !== source.text.length) throw new PassageBuildError('INVALID_PROVENANCE');
}

function structure(text: string) {
  const lines: number[] = [];
  const headings: Array<{ offset: number; title: string }> = [];
  const times: Array<{ offset: number; seconds: number }> = [];
  let offset = 0,
    fence: { marker: string; length: number } | null = null;
  for (const line of text.split('\n')) {
    lines.push(offset);
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (
        marker &&
        marker[1]![0] === fence.marker &&
        marker[1]!.length >= fence.length &&
        !marker[2]!.trim()
      )
        fence = null;
    } else if (marker) fence = { marker: marker[1]![0]!, length: marker[1]!.length };
    else {
      const heading = /^ {0,3}#{1,6}[ \t]+(.+?)\s*$/.exec(line);
      if (heading) {
        let title = heading[1]!.replace(/[ \t]+#+[ \t]*$/, '');
        const end = splitsPair(title, 200) ? 199 : 200;
        title = title.slice(0, end);
        headings.push({ offset, title });
        if (headings.length > MAX_PASSAGES) throw new PassageBuildError('INDEX_CAPACITY');
      }
      const seconds = parseLineTimestamp(line);
      if (seconds !== null) times.push({ offset, seconds });
    }
    offset += line.length + 1;
  }
  return { lines, headings, times };
}

/** Last sorted position at or before the requested source offset. */
function before<T>(items: T[], offset: number, position: (item: T) => number): number {
  let left = 0,
    right = items.length;
  while (left < right) {
    const middle = Math.floor((left + right) / 2);
    if (position(items[middle]!) <= offset) left = middle + 1;
    else right = middle;
  }
  return left - 1;
}

function timeRange(
  times: Array<{ offset: number; seconds: number }>,
  start: number,
  end: number,
  regionStart: number,
) {
  const first = Math.max(
    before(times, regionStart - 1, (item) => item.offset) + 1,
    before(times, start, (item) => item.offset),
  );
  const last = before(times, end - 1, (item) => item.offset);
  const unavailable = { startSec: null, endSec: null };
  if (last < first) return unavailable;
  for (let index = first + 1; index <= last; index++)
    if (times[index]!.seconds < times[index - 1]!.seconds) return unavailable;
  return { startSec: times[first]!.seconds, endSec: times[last]!.seconds };
}

/** Literal windows only: provenance comes from the caller's verified source map. */
export function buildPassages(source: PassageSource) {
  validate(source);
  const checksum = hash(source.text);
  const snapshot = hash(
    JSON.stringify({
      userId: source.userId,
      type: source.type,
      id: source.id,
      revision: source.revision,
      title: source.title,
      checksum,
      regions: source.regions,
    }),
  );
  const passages: Passage[] = [];
  if (!source.text.trim()) return { checksum, snapshot, passages };
  const { lines, headings, times } = structure(source.text);
  for (const region of source.regions) {
    const boundaries = [region.start];
    for (
      let h = before(headings, region.start, (item) => item.offset) + 1;
      h < headings.length && headings[h]!.offset < region.end;
      h++
    )
      boundaries.push(headings[h]!.offset);
    boundaries.push(region.end);
    for (let index = 0; index < boundaries.length - 1; index++) {
      let start = boundaries[index]!;
      const boundary = boundaries[index + 1]!;
      while (start < boundary) {
        let end = Math.min(start + WINDOW, boundary);
        if (end < boundary) {
          const newline = source.text.lastIndexOf('\n', end - 1);
          if (newline >= start + WINDOW / 2) end = newline + 1;
          if (splitsPair(source.text, end)) end--;
        }
        const text = source.text.slice(start, end);
        passages.push({
          key: hash(`${snapshot}:${start}:${end}`),
          checksum: hash(text),
          text,
          kind: region.kind,
          authority: region.authority,
          section: headings[before(headings, start, (item) => item.offset)]?.title ?? null,
          startOffset: start,
          endOffset: end,
          startLine: before(lines, start, (value) => value) + 1,
          endLine: before(lines, end - 1, (value) => value) + 1,
          ...timeRange(times, start, end, region.start),
        });
        if (passages.length > MAX_PASSAGES) throw new PassageBuildError('INDEX_CAPACITY');
        if (end === boundary) break;
        start = end - OVERLAP;
        if (splitsPair(source.text, start)) start++;
      }
    }
  }
  return { checksum, snapshot, passages };
}
