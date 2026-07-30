import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const webRoot = join(import.meta.dir, '..');

function read(relativePath: string): string {
  return readFileSync(join(webRoot, relativePath), 'utf8');
}

function metadataWindow(source: string, marker: string, length = 180): string {
  const markerIndex = source.indexOf(marker);
  expect(markerIndex).toBeGreaterThanOrEqual(0);
  return source.slice(markerIndex, markerIndex + length);
}

describe('privacidade da telemetria de enriquecimento', () => {
  test('métricas de tags registram contagem, não os nomes gerados', () => {
    const transcriptTags = metadataWindow(
      read('src/routes/transcripts.ts'),
      "source: 'tag_generation'",
    );
    const backfillTags = metadataWindow(
      read('src/routes/library.ts'),
      "source: 'tag_generation_backfill'",
    );
    const agentTags = metadataWindow(
      read('src/lib/agent-content.ts'),
      "source: 'agent_transcript_tags'",
    );

    for (const metadata of [transcriptTags, backfillTags, agentTags]) {
      expect(metadata).toContain('generated_count');
      expect(metadata).not.toMatch(/\btags\s*:/);
    }
  });

  test('classificação registra somente o resultado, não o nome da pasta', () => {
    const classification = metadataWindow(
      read('src/routes/library.ts'),
      "source: 'folder_classification_backfill'",
    );

    expect(classification).toContain('classified: Boolean(result.folderName)');
    expect(classification).not.toContain('folder_name');
  });

  test('erros da OpenRouter não carregam o corpo externo para diagnósticos', () => {
    const consumers = [
      'src/lib/tags-generate.ts',
      'src/lib/folder-classify.ts',
      'src/lib/title-generate.ts',
      'src/lib/transcript-summary.ts',
      'src/lib/web-research.ts',
    ];

    for (const consumer of consumers) {
      const source = read(consumer);
      expect(source).not.toMatch(/await (?:res|response)\.text\(\)/);
    }

    const transcriptRoute = read('src/routes/transcripts.ts');
    const failureWindow = metadataWindow(
      transcriptRoute,
      "console.error('[transcripts] falha ao gerar tags'",
      320,
    );
    expect(failureWindow).toContain('error_type');
    expect(failureWindow).not.toContain('err.message');
  });
});
