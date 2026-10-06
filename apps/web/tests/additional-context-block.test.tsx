import React from 'react';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import {
  AdditionalContextBlock,
  safeExternalCitationUrl,
  type TranscriptEnrichment,
} from '../src/client/components/library/additional-context-block';
import { I18nProvider, type TranslateFn } from '../src/client/lib/i18n';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;

beforeAll(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: { getItem: () => null, setItem: () => undefined },
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
      matchMedia: () => ({ matches: false }),
    },
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      documentElement: { lang: 'en' },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
  });
});

afterAll(() => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
});

const enrichment: TranscriptEnrichment = {
  id: 'context-1',
  revision: 1,
  checksum: 'a'.repeat(64),
  projection: { state: 'SYNCED', revision: 1, appliedRevision: 1, errorCode: null },
  status: 'READY',
  reviewState: 'SUGGESTED',
  trigger: 'MANUAL',
  title: 'External evidence',
  content: 'Grounded **Markdown** content.',
  citations: [
    { url: 'https://example.org/evidence', title: 'Safe evidence', excerpt: 'Verified.' },
    { url: 'javascript:alert(1)', title: 'Unsafe evidence', excerpt: 'Blocked.' },
  ],
  queries: ['external evidence'],
  rationale: 'The source lacked this context.',
  noResearchReason: null,
  model: 'test/model',
  staleReason: null,
  lastError: null,
  createdAt: '2026-08-07T13:00:00.000Z',
  updatedAt: '2026-08-07T13:00:00.000Z',
};

const t = ((key: string) => key) as TranslateFn;

describe('AdditionalContextBlock', () => {
  test('allows only HTTP citations', () => {
    expect(safeExternalCitationUrl('https://example.org/source')).toBe(
      'https://example.org/source',
    );
    expect(safeExternalCitationUrl('http://example.org/source')).toBe('http://example.org/source');
    expect(safeExternalCitationUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalCitationUrl('not-a-url')).toBeNull();
  });

  test('renders review actions and omits unsafe citation links', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <I18nProvider>
          <AdditionalContextBlock
            enrichments={[enrichment]}
            researchMode="MANUAL"
            loading={false}
            locale="en"
            onQueue={() => undefined}
            onUpdate={async () => undefined}
            onDelete={async () => undefined}
            t={t}
          />
        </I18nProvider>,
      );
    });

    const links = renderer.root.findAllByType('a');
    expect(links).toHaveLength(1);
    expect(links[0]?.props.href).toBe('https://example.org/evidence');
    expect(links[0]?.props.rel).toBe('noopener noreferrer');
    const renderedText = renderer.root
      .findAll((node) => node.children.some((child) => typeof child === 'string'))
      .flatMap((node) =>
        node.children.filter((child): child is string => typeof child === 'string'),
      );
    expect(renderedText).toContain('library.additionalContextAccept');
    expect(renderedText).toContain('library.additionalContextDismiss');
  });

  test('renders an actionable message for exhausted OpenRouter credits', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <I18nProvider>
          <AdditionalContextBlock
            enrichments={[
              {
                ...enrichment,
                status: 'FAILED',
                lastError: 'OPENROUTER_CREDITS_EXHAUSTED',
              },
            ]}
            researchMode="MANUAL"
            loading={false}
            locale="en"
            onQueue={() => undefined}
            onUpdate={async () => undefined}
            onDelete={async () => undefined}
            t={t}
          />
        </I18nProvider>,
      );
    });

    const renderedText = renderer.root
      .findAll((node) => node.children.some((child) => typeof child === 'string'))
      .flatMap((node) =>
        node.children.filter((child): child is string => typeof child === 'string'),
      );
    expect(renderedText).toContain('library.additionalContextCreditsExhausted');
  });
  test('retains the observed edit snapshot and draft across polling and conflicts', async () => {
    let renderer!: ReactTestRenderer;
    let sent: Record<string, unknown> = {};
    let reject = true;
    const onUpdate = async (_id: string, body: Record<string, unknown>) => {
      sent = body;
      if (reject) throw new Error('Conflict');
    };
    const view = (row: TranscriptEnrichment) => (
      <I18nProvider>
        <AdditionalContextBlock
          enrichments={[row]}
          researchMode="MANUAL"
          loading={false}
          locale="en"
          onQueue={() => undefined}
          onUpdate={onUpdate}
          onDelete={async () => undefined}
          t={t}
        />
      </I18nProvider>
    );
    const button = (text: string) =>
      renderer.root.findAllByType('button').find((node) => node.children.includes(text))!;
    await act(async () => {
      renderer = create(view(enrichment));
    });
    await act(async () => {
      button('notes.edit').props.onClick();
    });
    await act(async () => {
      renderer.root.findByType('textarea').props.onChange({ target: { value: 'Unsaved draft' } });
    });
    await act(async () => {
      renderer.update(
        view({ ...enrichment, revision: 2, checksum: 'b'.repeat(64), content: 'Other editor' }),
      );
    });
    await act(async () => {
      button('common.save').props.onClick();
    });
    expect(sent).toMatchObject({
      action: 'edit',
      expectedRevision: 1,
      expectedChecksum: 'a'.repeat(64),
      content: 'Unsaved draft',
    });
    expect(renderer.root.findByType('textarea').props.value).toBe('Unsaved draft');
    reject = false;
    await act(async () => {
      button('common.cancel').props.onClick();
    });
    await act(async () => {
      button('library.additionalContextAccept').props.onClick();
    });
    expect(sent).toMatchObject({
      action: 'accept',
      expectedRevision: 2,
      expectedChecksum: 'b'.repeat(64),
    });
    await act(async () => {
      renderer.unmount();
    });
  });
});
