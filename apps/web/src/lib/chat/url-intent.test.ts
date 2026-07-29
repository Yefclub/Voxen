import { describe, expect, it } from 'bun:test';
import { buildUrlIntentInstructions, classifyUrlIntent, isSharedUrl } from './url-intent';

describe('classifyUrlIntent', () => {
  it('marks an explicit request to process a shared URL as ingestion', () => {
    const intent = classifyUrlIntent('Transcreva e resuma https://example.com/video.');

    expect(intent).toEqual({ kind: 'explicit-ingest', urls: ['https://example.com/video'] });
    expect(isSharedUrl(intent, 'https://example.com/video')).toBe(true);
  });

  it('keeps a bare URL ambiguous instead of choosing a tool action', () => {
    const intent = classifyUrlIntent('Olha este link: https://example.com/artigo');

    expect(intent.kind).toBe('ambiguous');
    expect(buildUrlIntentInstructions(intent)).toContain('Não use web_search');
  });

  it('does not affect messages without a URL', () => {
    expect(classifyUrlIntent('Qual foi a notícia de hoje?')).toEqual({ kind: 'none', urls: [] });
  });

  it('keeps an invalid URL ambiguous and never enables a web-search fallback', () => {
    expect(classifyUrlIntent('Transcreva https://')).toEqual({ kind: 'ambiguous', urls: [] });
  });
});
