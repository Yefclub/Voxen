import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { db } from '../src/lib/db';

const migration = readFileSync(
  new URL(
    '../../../prisma/migrations/20260730123000_cleanup_invalid_content_tags/migration.sql',
    import.meta.url,
  ),
  'utf8',
);
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describe('migration de saneamento de tags', () => {
  test('usa o mesmo predicado para excluir variantes e reencaminha somente conteúdos sem tags', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION voxen_invalid_content_tag');
    expect(migration).toContain('WHERE voxen_invalid_content_tag(name)');
    expect(migration).toContain("'json array only'");
    expect(migration).toContain('position(marker IN lower(trim(value))) > 0');
    expect(migration).toContain('WHERE NOT EXISTS');
    expect(migration).toContain('"taggingStatus" = \'PENDING\'::"EnrichmentStatus"');
  });
});

describeIfDb('predicado SQL de tags inválidas', () => {
  afterAll(async () => {
    await db.$disconnect();
  });

  test.each([
    'Please return JSON array only',
    'We found 5 tags total',
    'Here is the tags list',
    'Este conteúdo fala sobre testes',
    'No duplicates please',
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
});
