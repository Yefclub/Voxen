import { describe, expect, it } from 'bun:test';
import { buildWebResearchPayload } from '../src/lib/web-research';

describe('buildWebResearchPayload', () => {
  it('usa a server tool atual do OpenRouter para pesquisa web', () => {
    const payload = buildWebResearchPayload('openai/model', 'notícias atuais', 'web');
    expect(payload.model).toBe('openai/model');
    expect(payload.tools).toEqual([
      { type: 'openrouter:web_search', engine: 'auto', max_results: 8 },
    ]);
    expect(payload.messages[1]?.content).toBe('notícias atuais');
  });

  it('orienta o modelo Grok configurado a priorizar publicações do X', () => {
    const payload = buildWebResearchPayload('x-ai/grok', 'Voxen', 'x');
    expect(payload.model).toBe('x-ai/grok');
    expect(payload.messages[1]?.content).toContain('x.com');
  });
});
