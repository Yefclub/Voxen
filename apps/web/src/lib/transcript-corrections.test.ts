import { describe, expect, test } from 'bun:test';
import {
  applyTranscriptPatch,
  effectiveTranscriptContent,
  searchWithinTranscript,
  TranscriptCorrectionInvariantError,
  transcriptCorrectionChecksum,
  transcriptMarkdownToPlainText,
} from './transcript-corrections';

describe('transcript correction content', () => {
  test('preserves canonical frontmatter and existing timestamps', () => {
    const markdown = '---\ntitle: Source\n---\n# Transcript\n\n[00:01] original';
    expect(() =>
      applyTranscriptPatch(markdown, {
        kind: 'replace',
        target: 'title: Source',
        text: 'title: Edit',
      }),
    ).toThrow(TranscriptCorrectionInvariantError);
    expect(() =>
      applyTranscriptPatch(markdown, { kind: 'replace', target: '[00:01]', text: '[00:02]' }),
    ).toThrow(TranscriptCorrectionInvariantError);
    expect(
      applyTranscriptPatch(markdown, { kind: 'append', text: '\n[00:02] additional context' })
        .content,
    ).toContain('[00:02] additional context');
  });

  test('rejects corrections without searchable textual content', () => {
    expect(() =>
      applyTranscriptPatch('# Transcript\n\ncontent', {
        kind: 'replace',
        target: '# Transcript\n\ncontent',
        text: '   ',
      }),
    ).toThrow(TranscriptCorrectionInvariantError);
  });

  test('patches one exact timestamped passage without changing surrounding evidence', () => {
    const markdown = '[00:00:01] Alpha\n[00:00:03] wrong word\n[00:00:08] Omega';
    const patched = applyTranscriptPatch(markdown, {
      kind: 'replace',
      target: 'wrong word',
      text: 'correct word',
    });
    expect(patched.content).toBe('[00:00:01] Alpha\n[00:00:03] correct word\n[00:00:08] Omega');
    expect(patched.startLine).toBe(2);
  });

  test('supports transcripts larger than the note limit', () => {
    const markdown = `start\n${'x'.repeat(250_000)}\nneedle`;
    expect(
      applyTranscriptPatch(markdown, { kind: 'replace', target: 'needle', text: 'fixed' }).content,
    ).toEndWith('fixed');
  });

  test('derives searchable text without frontmatter or timestamp markers', () => {
    const markdown = [
      '---',
      'title: Example',
      '---',
      '# Transcript',
      '[00:00:01] First sentence.',
      '[01:02:03] Second **sentence**.',
    ].join('\n');
    expect(transcriptMarkdownToPlainText(markdown)).toBe(
      'Transcript\nFirst sentence.\nSecond sentence.',
    );
  });

  test('uses an active overlay and falls back to canonical content when stale', () => {
    const base = {
      plainText: 'canonical text',
      correctedPlainText: 'corrected text',
      correctedMarkdown: 'corrected markdown',
      correctionState: 'ACTIVE' as const,
    };
    expect(effectiveTranscriptContent(base)).toEqual({
      plainText: 'corrected text',
      markdown: 'corrected markdown',
      corrected: true,
    });
    expect(effectiveTranscriptContent({ ...base, correctionState: 'STALE' })).toEqual({
      plainText: 'canonical text',
      markdown: null,
      corrected: false,
    });
  });
});

describe('transcript correction search and checksums', () => {
  test('returns bounded occurrences in effective Markdown', () => {
    const matches = searchWithinTranscript('one\nNeedle here\nneedle again', 'needle', {
      contextChars: 6,
    });
    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({ line: 2, occurrence: 1, matchedText: 'Needle' });
  });

  test('checksum covers both rendered and searchable representations', () => {
    const first = transcriptCorrectionChecksum('markdown', 'plain');
    expect(first).toHaveLength(64);
    expect(first).not.toBe(transcriptCorrectionChecksum('markdown changed', 'plain'));
    expect(first).not.toBe(transcriptCorrectionChecksum('markdown', 'plain changed'));
  });
});
