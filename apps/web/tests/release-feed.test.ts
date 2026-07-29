import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseReleaseFeedQuery, selectReleaseFeedPage } from '../src/shared/release-feed';

const releases = [
  { version: '1.3.0', channel: 'prod', type: 'feat', title: 'Biblioteca inteligente' },
  { version: '1.2.1-dev.3', channel: 'dev', type: 'fix', title: 'Corrige o menu mobile' },
  { version: '1.2.0', channel: 'prod', type: 'security', title: 'Sessões protegidas' },
];

describe('feed de novidades', () => {
  test('normaliza filtros e limita paginação', () => {
    expect(
      parseReleaseFeedQuery({
        channel: 'INVALID',
        type: ' FIX ',
        query: ' menu ',
        limit: '999',
        offset: '-2',
      }),
    ).toEqual({
      channel: 'all',
      type: 'fix',
      query: 'menu',
      limit: 50,
      offset: 0,
    });
    expect(parseReleaseFeedQuery({ type: 'unknown' }).type).toBeNull();
  });

  test('combina canal, tipo, busca e paginação com total estável', () => {
    const page = selectReleaseFeedPage(
      releases,
      parseReleaseFeedQuery({ channel: 'prod', query: 'a', limit: '1', offset: '1' }),
    );
    expect(page.releases).toEqual([releases[2]!]);
    expect(page.total).toBe(2);
    expect(page.hasMore).toBe(false);
  });

  test('busca em título, resumo, corpo, versão e tipo', () => {
    const page = selectReleaseFeedPage(releases, parseReleaseFeedQuery({ query: 'mobile' }));
    expect(page.releases.map((release) => release.version)).toEqual(['1.2.1-dev.3']);
  });

  test('mantém o feed anterior, mas sinaliza falha de um novo filtro', () => {
    const page = readFileSync(join(import.meta.dir, '../src/client/pages/novidades.tsx'), 'utf8');
    expect(page).toContain('error && feed');
    expect(page).toContain("t('novidades.refreshError')");
    expect(page).toContain('onClick={refresh}');
  });
});
