import { describe, expect, test } from 'bun:test';
import {
  NotePatchError,
  applyNotePatch,
  noteContentChecksum,
  searchWithinNote,
} from './note-revisions';

describe('surgical note patches', () => {
  test('replaces a unique exact passage and reports its position', () => {
    const result = applyNotePatch('Alpha\nBeta\nGamma', {
      kind: 'replace',
      target: 'Beta',
      text: 'Beta revised',
    });
    expect(result.content).toBe('Alpha\nBeta revised\nGamma');
    expect(result.matchCount).toBe(1);
    expect(result.start).toBe(6);
    expect(result.startLine).toBe(2);
  });

  test('rejects an ambiguous target unless the occurrence is explicit', () => {
    expect(() =>
      applyNotePatch('same / same / same', { kind: 'replace', target: 'same', text: 'new' }),
    ).toThrow(NotePatchError);
    try {
      applyNotePatch('same / same / same', { kind: 'replace', target: 'same', text: 'new' });
    } catch (error) {
      expect(error).toMatchObject({ code: 'AMBIGUOUS_TARGET', matchCount: 3 });
    }
    expect(
      applyNotePatch('same / same / same', {
        kind: 'replace',
        target: 'same',
        text: 'new',
        occurrence: 2,
      }).content,
    ).toBe('same / new / same');
  });

  test('supports exact insertions, prepend, and append', () => {
    expect(
      applyNotePatch('middle', { kind: 'insert_before', target: 'middle', text: 'before ' })
        .content,
    ).toBe('before middle');
    expect(
      applyNotePatch('middle', { kind: 'insert_after', target: 'middle', text: ' after' }).content,
    ).toBe('middle after');
    expect(applyNotePatch('middle', { kind: 'prepend', text: 'start ' }).content).toBe(
      'start middle',
    );
    expect(applyNotePatch('middle', { kind: 'append', text: ' end' }).content).toBe('middle end');
  });

  test('rejects absent targets, empty operations, and oversized results', () => {
    expect(() =>
      applyNotePatch('body', { kind: 'replace', target: 'missing', text: 'new' }),
    ).toThrow('target was not found');
    expect(() => applyNotePatch('body', { kind: 'append', text: '' })).toThrow(
      'Patch text cannot be empty',
    );
    expect(() => applyNotePatch('body', { kind: 'append', text: 'x'.repeat(200_000) })).toThrow(
      'maximum size',
    );
  });
});

describe('targeted note search', () => {
  test('returns bounded offsets, line numbers, and context', () => {
    const content = ['first line', 'needle one', 'another line', 'needle two'].join('\n');
    const matches = searchWithinNote(content, 'needle', { limit: 1, contextChars: 8 });
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ line: 2, occurrence: 1, matchedText: 'needle' });
    expect(matches[0]?.context).toContain('needle');
  });

  test('is case insensitive while retaining exact source offsets', () => {
    const matches = searchWithinNote('Alpha BETA gamma', 'beta');
    expect(matches[0]).toMatchObject({ start: 6, end: 10, matchedText: 'BETA' });
  });
});

test('note checksums are deterministic and cover title plus content', () => {
  expect(noteContentChecksum('Title', 'Body')).toBe(noteContentChecksum('Title', 'Body'));
  expect(noteContentChecksum('Title', 'Body')).not.toBe(noteContentChecksum('Other', 'Body'));
  expect(noteContentChecksum('Title', 'Body')).toHaveLength(64);
});
