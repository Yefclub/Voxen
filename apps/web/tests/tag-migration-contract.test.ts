import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { db } from '../src/lib/db';
import { TAG_BAD_MARKERS, TAG_STOP_LABELS } from '../src/lib/tags-generate';

const migration = readFileSync(
  new URL(
    '../../../prisma/migrations/20260730123000_cleanup_invalid_content_tags/migration.sql',
    import.meta.url,
  ),
  'utf8',
);
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describe('migration de saneamento de tags', () => {
  test('espelha todos os marcadores do parser e reencaminha somente conteúdos sem tags', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION voxen_invalid_content_tag');
    for (const marker of TAG_BAD_MARKERS) {
      expect(migration).toContain(`'${marker.replaceAll("'", "''")}'`);
    }
    for (const label of TAG_STOP_LABELS) {
      expect(migration).toContain(`'${label.replaceAll("'", "''")}'`);
    }
    expect(migration).toContain('position(marker IN lower(trim(value))) > 0');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION voxen_cleanup_invalid_content_tags');
    expect(migration).toContain('AND voxen_invalid_content_tag(tag.name)');
    expect(migration).toContain('AND NOT EXISTS');
    expect(migration).toContain('"taggingStatus" = \'PENDING\'::"EnrichmentStatus"');
  });
});

describeIfDb('predicado SQL de tags inválidas', () => {
  test.each([
    'Please return JSON array only',
    'We found 5 tags total',
    'Here is the tags list',
    'Este conteúdo fala sobre testes',
    'No duplicates please',
    'The user requested tags',
    'I will create tags',
    'Looking at metadata',
    'Here are some labels',
  ])('remove metalinguagem em qualquer posição: %s', async (value) => {
    const rows = await db.$queryRawUnsafe<Array<{ invalid: boolean }>>(
      'SELECT voxen_invalid_content_tag($1) AS invalid',
      value,
    );
    expect(rows[0]?.invalid).toBe(true);
  });

  test.each(['Segurança Web', 'PostgreSQL', 'Design de interface'])(
    'preserva tag válida: %s',
    async (value) => {
      const rows = await db.$queryRawUnsafe<Array<{ invalid: boolean }>>(
        'SELECT voxen_invalid_content_tag($1) AS invalid',
        value,
      );
      expect(rows[0]?.invalid).toBe(false);
    },
  );

  test('remove relações inválidas, preserva válidas e reencaminha de forma idempotente', async () => {
    const suffix = randomUUID();
    const user = await db.user.create({
      data: {
        email: `tag-migration-${suffix}@voxen.local`,
        name: 'Tag Migration Test',
        status: 'APPROVED',
      },
    });

    try {
      const invalidJson = await db.tag.create({
        data: {
          userId: user.id,
          name: 'Please return JSON array only',
          slug: `invalid-json-${suffix}`,
        },
      });
      const invalidIntent = await db.tag.create({
        data: {
          userId: user.id,
          name: 'I will create tags',
          slug: `invalid-intent-${suffix}`,
        },
      });
      const valid = await db.tag.create({
        data: {
          userId: user.id,
          name: 'Segurança Web',
          slug: `seguranca-web-${suffix}`,
        },
      });

      const createTranscript = (title: string, tagIds: string[], plainText = 'Conteúdo de teste') =>
        db.transcript.create({
          data: {
            userId: user.id,
            source: 'UPLOAD',
            url: `upload://${suffix}/${title}`,
            title,
            durationSec: 1,
            language: 'pt',
            transcriptionMethod: 'API',
            mdPath: `${suffix}/${title}.md`,
            plainText,
            frontmatter: {},
            taggingStatus: 'COMPLETE',
            taggingAttempts: 4,
            taggingError: 'estado anterior',
            tags: {
              create: tagIds.map((tagId) => ({ tag: { connect: { id: tagId } } })),
            },
          },
        });

      const invalidOnly = await createTranscript('invalid-only', [invalidJson.id]);
      const mixed = await createTranscript('mixed', [invalidIntent.id, valid.id]);
      const validOnly = await createTranscript('valid-only', [valid.id]);
      const emptyText = await createTranscript('empty-text', [], '');

      const firstRun = await db.$queryRawUnsafe<Array<{ cleaned: boolean }>>(
        'SELECT voxen_cleanup_invalid_content_tags($1::TEXT) AS cleaned',
        user.id,
      );
      const secondRun = await db.$queryRawUnsafe<Array<{ cleaned: boolean }>>(
        'SELECT voxen_cleanup_invalid_content_tags($1::TEXT) AS cleaned',
        user.id,
      );
      expect(firstRun[0]?.cleaned).toBe(true);
      expect(secondRun[0]?.cleaned).toBe(true);

      const remainingTags = await db.tag.findMany({
        where: { userId: user.id },
        select: { id: true, name: true },
      });
      expect(remainingTags).toEqual([{ id: valid.id, name: 'Segurança Web' }]);

      const transcripts = await db.transcript.findMany({
        where: {
          id: { in: [invalidOnly.id, mixed.id, validOnly.id, emptyText.id] },
        },
        include: { tags: true },
      });
      const byId = new Map(transcripts.map((transcript) => [transcript.id, transcript]));

      expect(byId.get(invalidOnly.id)).toMatchObject({
        taggingStatus: 'PENDING',
        taggingAttempts: 0,
        taggingError: null,
        tags: [],
      });
      expect(byId.get(mixed.id)).toMatchObject({
        taggingStatus: 'COMPLETE',
        taggingAttempts: 4,
      });
      expect(byId.get(mixed.id)?.tags).toHaveLength(1);
      expect(byId.get(validOnly.id)).toMatchObject({
        taggingStatus: 'COMPLETE',
        taggingAttempts: 4,
      });
      expect(byId.get(emptyText.id)).toMatchObject({
        taggingStatus: 'COMPLETE',
        taggingAttempts: 4,
        tags: [],
      });
    } finally {
      await db.user.delete({ where: { id: user.id } });
    }
  });
});
