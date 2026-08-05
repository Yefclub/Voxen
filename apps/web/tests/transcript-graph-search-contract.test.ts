import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../src/client/pages/transcricoes.tsx', import.meta.url), 'utf8');
const search = readFileSync(
  new URL('../src/client/components/library/library-search.tsx', import.meta.url),
  'utf8',
);
const route = readFileSync(new URL('../src/routes/transcripts.ts', import.meta.url), 'utf8');
const graphSearch = readFileSync(
  new URL('../src/lib/transcript-graph-search.ts', import.meta.url),
  'utf8',
);

describe('transcript graph search contract', () => {
  test('places discovery before ingestion and identifies graph results', () => {
    expect(page.indexOf('<LibrarySearch')).toBeLessThan(page.indexOf('<ContentIngestCard />'));
    expect(search).toContain('aria-labelledby="library-search-title"');
    expect(page).toContain("translate('library.graphMatch')");
    expect(page).toContain('t.graphMatch');
  });

  test('requires user scope on Brain evidence and nodes', () => {
    expect(graphSearch).toContain('bs."userId" = ${userId}');
    expect(graphSearch).toContain('bn."userId" = ${userId}');
    expect(graphSearch).toContain('bs."sourceId" = t.id');
    expect(graphSearch).toContain('MIN_GRAPH_QUERY_LENGTH = 3');
    expect(graphSearch).toContain('TRANSCRIPT_GRAPH_RANK_BOOST = 0.03');
    expect(route).toContain('OR ${graphMatchSql}');
  });
});
