import { describe, expect, test } from 'bun:test';
import {
  enforceReleaseFeedEnvironment,
  localizeReleaseEntry,
  parseReleaseFeedQuery,
  selectReleaseFeedPage,
} from './release-feed';

const entries = [
  {
    version: '1.1.0-dev.1',
    channel: 'dev',
    type: 'feat',
    title: 'Development fallback',
    body: 'Development fallback body',
    translations: {
      'pt-BR': { title: 'Novidade de desenvolvimento', body: 'Corpo de desenvolvimento' },
      en: { title: 'Development feature', body: 'Development body' },
    },
  },
  {
    version: '1.0.0',
    channel: 'prod',
    type: 'fix',
    title: 'Production fallback',
    body: 'Production fallback body',
    translations: {
      'pt-BR': { title: 'Correção em produção', body: 'Corpo de produção' },
      en: { title: 'Production fix', body: 'Production body' },
    },
  },
] as const;

describe('release feed environment', () => {
  test('forces development entries even when the request asks for production', () => {
    const query = enforceReleaseFeedEnvironment(
      parseReleaseFeedQuery({ channel: 'prod', limit: '50' }),
      'dev',
    );

    expect(selectReleaseFeedPage(entries, query).releases.map((entry) => entry.channel)).toEqual([
      'dev',
    ]);
  });

  test('forces production entries even when the request asks for development', () => {
    const query = enforceReleaseFeedEnvironment(
      parseReleaseFeedQuery({ channel: 'dev', limit: '50' }),
      'prod',
    );

    expect(selectReleaseFeedPage(entries, query).releases.map((entry) => entry.channel)).toEqual([
      'prod',
    ]);
  });
});

describe('localized release content', () => {
  test('uses the selected translation for release and promoted content', () => {
    const localized = localizeReleaseEntry(
      {
        ...entries[0],
        promoted: [
          {
            title: 'Promoted fallback',
            body: 'Promoted fallback body',
            translations: {
              'pt-BR': { title: 'Mudança promovida', body: 'Corpo promovido' },
              en: { title: 'Promoted change', body: 'Promoted body' },
            },
          },
        ],
      },
      'pt-BR',
    );

    expect(localized.title).toBe('Novidade de desenvolvimento');
    expect(localized.body).toBe('Corpo de desenvolvimento');
    expect(localized.promoted?.[0]).toMatchObject({
      title: 'Mudança promovida',
      body: 'Corpo promovido',
    });
  });

  test('falls back to English and then the historical text when a translation is absent', () => {
    expect(localizeReleaseEntry(entries[0], 'en').title).toBe('Development feature');
    expect(
      localizeReleaseEntry(
        { version: '0.1.0', channel: 'prod', title: 'Legacy title', body: 'Legacy body' },
        'pt-BR',
      ),
    ).toMatchObject({ title: 'Legacy title', body: 'Legacy body' });
  });
});
