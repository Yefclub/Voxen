import { describe, expect, it } from 'bun:test';
import {
  NoteAnchorInputSchema,
  NoteAnchorValidationError,
  validateNoteAnchors,
} from './note-anchors';

describe('note anchor input', () => {
  it('accepts line, time, and combined anchors', () => {
    expect(
      NoteAnchorInputSchema.safeParse({
        transcriptId: 't1',
        startLine: 10,
        endLine: 12,
        selectedQuote: 'Verified passage',
      }).success,
    ).toBe(true);
    expect(
      NoteAnchorInputSchema.safeParse({
        transcriptId: 't1',
        startSec: 60,
        endSec: 75,
        selectedQuote: 'Verified passage',
      }).success,
    ).toBe(true);
  });

  it('rejects missing, partial, and inverted ranges', () => {
    for (const anchor of [
      { transcriptId: 't1', selectedQuote: 'quote' },
      { transcriptId: 't1', startLine: 2, selectedQuote: 'quote' },
      { transcriptId: 't1', startLine: 3, endLine: 2, selectedQuote: 'quote' },
      { transcriptId: 't1', startSec: 8, endSec: 7, selectedQuote: 'quote' },
    ]) {
      expect(NoteAnchorInputSchema.safeParse(anchor).success).toBe(false);
    }
  });

  it('verifies the quote and records the canonical source version', async () => {
    let requestedUserId = '';
    const [anchor] = await validateNoteAnchors(
      'u1',
      [
        {
          transcriptId: 't1',
          startLine: 3,
          endLine: 3,
          selectedQuote: 'Verified passage',
          sourceVersion: 3,
          sourceChecksum: 'checksum',
        },
      ],
      {
        findTranscripts: async (userId) => {
          requestedUserId = userId;
          return [
            {
              id: 't1',
              title: 'Transcript',
              mdPath: 'workspaces/u1/transcripts/t1.md',
              plainText: 'Verified passage',
              durationSec: 60,
              sourceVersion: 3,
              sourceChecksum: 'checksum',
            },
          ];
        },
        readText: async () => '# Transcript\n\nVerified passage',
      },
    );
    expect(anchor).toMatchObject({ transcriptId: 't1', sourceVersion: 3, status: 'VALID' });
    expect(requestedUserId).toBe('u1');
  });

  it('hides cross-user transcripts and rejects stale source versions', async () => {
    await expect(
      validateNoteAnchors(
        'u1',
        [{ transcriptId: 'other-user', startLine: 1, endLine: 1, selectedQuote: 'secret' }],
        { findTranscripts: async () => [] },
      ),
    ).rejects.toBeInstanceOf(NoteAnchorValidationError);
    await expect(
      validateNoteAnchors(
        'u1',
        [
          {
            transcriptId: 't1',
            startLine: 1,
            endLine: 1,
            selectedQuote: 'Verified passage',
            sourceVersion: 3,
          },
        ],
        {
          findTranscripts: async () => [
            {
              id: 't1',
              title: 'Transcript',
              mdPath: 'workspaces/u1/transcripts/t1.md',
              plainText: 'Verified passage',
              durationSec: 60,
              sourceVersion: 4,
              sourceChecksum: 'new',
            },
          ],
        },
      ),
    ).rejects.toThrow('source version changed');
  });

  it('validates new anchors against the active corrected Markdown', async () => {
    const [anchor] = await validateNoteAnchors(
      'u1',
      [
        {
          transcriptId: 't1',
          startLine: 3,
          endLine: 3,
          selectedQuote: 'corrected passage',
        },
      ],
      {
        findTranscripts: async () => [
          {
            id: 't1',
            title: 'Transcript',
            mdPath: 'canonical.md',
            plainText: 'canonical passage',
            durationSec: 60,
            sourceVersion: 1,
            sourceChecksum: 'checksum',
            correctedMarkdown: '# Transcript\n\ncorrected passage',
            correctionState: 'ACTIVE',
          },
        ],
        readText: async () => '# Transcript\n\ncanonical passage',
      },
    );
    expect(anchor?.selectedQuote).toBe('corrected passage');
  });
});
