import { describe, expect, test } from 'bun:test';
import { extractKnowledgeDeletionPayload } from './knowledge-deletion';

describe('chat knowledge deletion approval payload', () => {
  test('accepts every supported knowledge target with an exact title', () => {
    for (const targetType of [
      'TRANSCRIPT',
      'NOTE',
      'SAVED_MEDIA',
      'LIBRARY_FOLDER',
      'TRANSCRIPT_ENRICHMENT',
    ] as const) {
      expect(
        extractKnowledgeDeletionPayload({
          action: 'delete_knowledge',
          targetType,
          targetId: `id-${targetType}`,
          title: `Title ${targetType}`,
        }),
      ).toMatchObject({ targetType, targetId: `id-${targetType}` });
    }
  });

  test('rejects unknown targets, missing titles, and non-deletion actions', () => {
    expect(
      extractKnowledgeDeletionPayload({
        action: 'delete_knowledge',
        targetType: 'USER',
        targetId: 'user-1',
        title: 'Someone',
      }),
    ).toBeNull();
    expect(
      extractKnowledgeDeletionPayload({
        action: 'delete_knowledge',
        targetType: 'NOTE',
        targetId: 'note-1',
        title: '',
      }),
    ).toBeNull();
    expect(
      extractKnowledgeDeletionPayload({
        action: 'patch_note',
        targetType: 'NOTE',
        targetId: 'note-1',
        title: 'Note',
      }),
    ).toBeNull();
  });
});
