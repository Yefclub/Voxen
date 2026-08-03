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
      version: null,
      invalidVersion: false,
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

  test('seleciona exatamente a versão e o canal pedidos pelo modal', () => {
    const page = selectReleaseFeedPage(
      releases,
      parseReleaseFeedQuery({ version: 'v1.2.1-dev.3', channel: 'dev', limit: '1' }),
    );
    expect(page.releases).toEqual([releases[1]!]);
    expect(page.total).toBe(1);

    const wrongChannel = selectReleaseFeedPage(
      releases,
      parseReleaseFeedQuery({ version: '1.2.1-dev.3', channel: 'prod', limit: '1' }),
    );
    expect(wrongChannel.releases).toEqual([]);
    expect(wrongChannel.total).toBe(0);
  });

  test('versão inválida solicitada nunca cai para a release mais recente', () => {
    const page = selectReleaseFeedPage(
      releases,
      parseReleaseFeedQuery({ version: '../latest', limit: '1' }),
    );
    expect(page.releases).toEqual([]);
    expect(page.total).toBe(0);
  });

  test('mantém o feed anterior, mas sinaliza falha de um novo filtro', () => {
    const page = readFileSync(join(import.meta.dir, '../src/client/pages/novidades.tsx'), 'utf8');
    expect(page).toContain('error && feed');
    expect(page).toContain("t('novidades.refreshError')");
    expect(page).toContain('onClick={refresh}');
  });

  test('modal mantém cabeçalho e rodapé fora da região rolável', () => {
    const modal = readFileSync(
      join(import.meta.dir, '../src/client/components/update-modal.tsx'),
      'utf8',
    );
    expect(modal).toContain('data-update-scroll-region');
    expect(modal).toContain('h-[min(calc(100dvh-1rem),56rem)]');
    expect(modal).toContain('max-w-5xl');
    expect(modal).toContain('grid-rows-[auto_minmax(0,1fr)_auto]');
    expect(modal).toContain('min-h-0 overflow-y-scroll overflow-x-hidden');
    expect(modal).not.toContain('flex h-full min-h-0 flex-col');
    expect(modal.indexOf('data-update-scroll-region')).toBeLessThan(modal.indexOf('<footer'));
    expect(modal).toContain('release.promoted');
    expect(modal).toContain("handleIntent('open-changelog')");
    expect(modal).toContain("handleIntent('defer')");
    expect(modal).toContain("handleIntent('apply')");
    expect(modal.match(/onClick=\{\(\) => setRetry/gu)).toHaveLength(2);
  });
});
