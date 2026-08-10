import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { db } from '../src/lib/db';
import { noteContentChecksum } from '../src/lib/note-revisions';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
const migrationPath = join(
  import.meta.dir,
  '../../../prisma/migrations/20260810090000_surgical_note_revisions/migration.sql',
);

describe('note revision migration contract', () => {
  test('backfill uses the canonical SHA-256 byte layout', async () => {
    const migration = await readFile(migrationPath, 'utf8');
    expect(migration).toContain('sha256(');
    expect(migration).toContain("convert_to(n.title, 'UTF8')");
    expect(migration).toContain("decode('00', 'hex')");
    expect(migration).toContain("convert_to(n.content, 'UTF8')");
    expect(migration).not.toContain('md5(');
  });
});

describeIfDb('note revision migration checksum semantics', () => {
  test('Postgres backfill expression matches the runtime for Unicode and line breaks', async () => {
    const title = 'Título cirúrgico 🧠';
    const content = 'Primeira linha\nConteúdo com ç e 漢字\nÚltima linha';
    const rows = await db.$queryRaw<Array<{ checksum: string }>>`
      SELECT encode(
        sha256(
          convert_to(${title}, 'UTF8') || decode('00', 'hex') || convert_to(${content}, 'UTF8')
        ),
        'hex'
      ) AS checksum
    `;
    expect(rows[0]?.checksum).toBe(noteContentChecksum(title, content));
  });
});
