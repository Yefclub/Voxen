import { describe, expect, test } from 'bun:test';
import {
  buildPassages,
  PassageBuildError,
  type PassageSource,
} from '../src/lib/passage-index/build';

function fixture(text: string, extra: Partial<PassageSource> = {}): PassageSource {
  return {
    userId: 'owner',
    type: 'transcript',
    id: 'document',
    revision: 'v3:c2',
    title: 'Source',
    text,
    regions: text.length
      ? [{ start: 0, end: text.length, kind: 'ORIGINAL', authority: 'CAPTURED_SOURCE' }]
      : [],
    ...extra,
  };
}
function validUnicode(text: string) {
  return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text);
}
describe('versioned literal passage construction', () => {
  test('keeps literal section, line and time anchors with deterministic owner-bound identities', () => {
    const text =
      '# Observatory\n\n[00:00:15] Orion is part of Vega.\n[00:00:21] The identifier is AWS-MCP-123.\n';
    const source = fixture(text),
      result = buildPassages(source);
    expect(result.passages).toHaveLength(1);
    expect(result.passages[0]).toMatchObject({
      text,
      section: 'Observatory',
      startOffset: 0,
      endOffset: text.length,
      startLine: 1,
      endLine: 4,
      startSec: 15,
      endSec: 21,
      kind: 'ORIGINAL',
      authority: 'CAPTURED_SOURCE',
    });
    expect(buildPassages(source)).toEqual(result);
    for (const change of [
      { userId: 'another-owner' },
      { id: 'another-source' },
      { revision: 'v4:c2' },
      { title: 'Changed title' },
    ])
      expect(buildPassages({ ...source, ...change }).passages[0]!.key).not.toBe(
        result.passages[0]!.key,
      );
    expect(buildPassages(fixture('Different text.')).checksum).not.toBe(result.checksum);
  });
  test('retains all text, middle identifiers and Unicode in bounded overlapping windows of one long line', () => {
    const text =
      'a'.repeat(3999) + '😀' + 'b'.repeat(30_000) + ' DISTINCT-MIDDLE-739 ' + 'c'.repeat(29_000);
    const { passages } = buildPassages(fixture(text));
    expect(passages.length).toBeGreaterThan(10);
    expect(passages.some((row) => row.text.includes('DISTINCT-MIDDLE-739'))).toBe(true);
    let end = 0;
    for (const row of passages) {
      expect(row.text).toBe(text.slice(row.startOffset, row.endOffset));
      expect(row.text.length).toBeLessThanOrEqual(4000);
      expect(validUnicode(row.text)).toBe(true);
      expect(row.startLine).toBe(1);
      expect(row.endLine).toBe(1);
      expect(row.startOffset).toBeLessThanOrEqual(end);
      if (end) expect(end - row.startOffset).toBeLessThanOrEqual(240);
      end = row.endOffset;
    }
    expect(end).toBe(text.length);
  });
  test('separates generated prose, recorded original spans and accepted external text without heading-based promotion', () => {
    const generated = '# Original source\nAn invented summary relationship.\n';
    const original = '# Summary\nOrion is explicitly part of Vega.\n';
    const text = generated + original;
    const result = buildPassages(
      fixture(text, {
        regions: [
          { start: 0, end: generated.length, kind: 'SOURCE_DERIVED', authority: null },
          {
            start: generated.length,
            end: text.length,
            kind: 'ORIGINAL',
            authority: 'USER_CORRECTED',
          },
        ],
      }),
    );
    expect(result.passages.map((row) => row.kind)).toEqual(['SOURCE_DERIVED', 'ORIGINAL']);
    expect(result.passages[1]).toMatchObject({
      startOffset: generated.length,
      text: original,
      authority: 'USER_CORRECTED',
      startLine: 3,
    });
    const external = buildPassages(
      fixture(original, {
        type: 'external_enrichment',
        regions: [{ start: 0, end: original.length, kind: 'EXTERNAL_ACCEPTED', authority: null }],
      }),
    );
    expect(external.passages[0]).toMatchObject({ kind: 'EXTERNAL_ACCEPTED', authority: null });
    const note = buildPassages(
      fixture(original, {
        type: 'note',
        regions: [{ start: 0, end: original.length, kind: 'ORIGINAL', authority: null }],
      }),
    );
    expect(note.passages[0]).toMatchObject({ kind: 'ORIGINAL', authority: null });
  });
  test('splits at real headings but does not treat fenced code as a new section', () => {
    const text =
      '# First\nA passage.\n```md\n# Code, not a section\n```\n## Second\n[00:01:20] Another passage.\n';
    const result = buildPassages(fixture(text));
    expect(result.passages.map((row) => row.section)).toEqual(['First', 'Second']);
    expect(result.passages[0]!.text).toContain('# Code, not a section');
    expect(result.passages[1]).toMatchObject({ startLine: 6, startSec: 80, endSec: 80 });
    expect(result.passages.map((row) => row.text).join('')).toBe(text);
  });
  test('rejects gaps, overlaps, invalid authority and surrogate-splitting provenance instead of fabricating classification', () => {
    const text = 'Orion 😀 Vega';
    for (const regions of [
      [],
      [
        {
          start: 1,
          end: text.length,
          kind: 'ORIGINAL' as const,
          authority: 'CAPTURED_SOURCE' as const,
        },
      ],
      [{ start: 0, end: text.length, kind: 'ORIGINAL' as const, authority: null }],
      [
        { start: 0, end: 7, kind: 'SOURCE_DERIVED' as const, authority: null },
        {
          start: 7,
          end: text.length,
          kind: 'ORIGINAL' as const,
          authority: 'USER_CORRECTED' as const,
        },
      ],
      [
        {
          start: 0,
          end: text.length,
          kind: 'SOURCE_DERIVED' as const,
          authority: 'CAPTURED_SOURCE' as const,
        },
      ],
    ])
      expect(() => buildPassages(fixture(text, { regions }))).toThrow(PassageBuildError);
  });
  test('rejects complete-source and excessive-section capacity before returning any partial result', () => {
    expect(() => buildPassages(fixture('x'.repeat(4_000_001)))).toThrow('INDEX_CAPACITY');
    expect(() => buildPassages(fixture('# Section\ntext\n'.repeat(4097)))).toThrow(
      'INDEX_CAPACITY',
    );
    expect(buildPassages(fixture('')).passages).toEqual([]);
  });
  test('rejects malformed Unicode rather than hashing replacement characters as source evidence', () => {
    for (const text of ['\ud800', '\udc00', 'before\ud800after'])
      expect(() => buildPassages(fixture(text))).toThrow('INVALID_SOURCE');
  });
  test('keeps line anchors when nonmonotonic timestamps cannot define a valid time range', () => {
    const text =
      '# Source\n[00:00:20] First passage.\n[00:00:05] Earlier clock.\n[00:00:30] Later passage.\n';
    expect(buildPassages(fixture(text)).passages[0]).toMatchObject({
      text,
      startLine: 1,
      endLine: 4,
      startSec: null,
      endSec: null,
    });
  });
  test('never carries a generated timestamp across an original-source provenance boundary', () => {
    const generated = '[00:05:00] A generated description.\n';
    const original = 'The captured source contains no timestamp.\n';
    const source = fixture(generated + original, {
      regions: [
        { start: 0, end: generated.length, kind: 'SOURCE_DERIVED', authority: null },
        {
          start: generated.length,
          end: generated.length + original.length,
          kind: 'ORIGINAL',
          authority: 'CAPTURED_SOURCE',
        },
      ],
    });
    expect(buildPassages(source).passages[1]).toMatchObject({
      text: original,
      startLine: 2,
      startSec: null,
      endSec: null,
    });
  });
});
