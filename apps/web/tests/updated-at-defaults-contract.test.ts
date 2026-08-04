import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const models = [
  'Automation',
  'BrainCompilation',
  'BrainCompilationSegment',
  'BrainEdge',
  'BrainNode',
  'LibraryFolder',
  'Note',
  'ResearchArtifact',
  'Tag',
] as const;

describe('shared updatedAt defaults', () => {
  test('keeps Prisma and database defaults for tables written by raw SQL', () => {
    const root = join(import.meta.dir, '../../..');
    const schema = readFileSync(join(root, 'prisma/schema.prisma'), 'utf8');
    const migration = readFileSync(
      join(root, 'prisma/migrations/20260804130000_restore_updated_at_defaults/migration.sql'),
      'utf8',
    );

    for (const model of models) {
      const block = schema.match(new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';
      expect(block).toMatch(/updatedAt\s+DateTime\s+@default\(now\(\)\)\s+@updatedAt/);
      expect(migration).toContain(
        `ALTER TABLE "${model}" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;`,
      );
    }
  });
});
