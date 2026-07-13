import { describe, expect, it } from 'bun:test';
import { buildWebResearchPayload, selectResearchModel } from '../src/lib/web-research';

describe('buildWebResearchPayload', () => {
  it('usa a server tool atual do OpenRouter para pesquisa web', () => {
    const payload = buildWebResearchPayload('openai/model', 'notícias atuais', 'web');
    expect(payload.model).toBe('openai/model');
    expect(payload.tools).toEqual([
      {
        type: 'openrouter:web_search',
        parameters: { engine: 'auto', max_results: 8 },
      },
    ]);
    expect(payload.messages[1]?.content).toBe('notícias atuais');
  });

  it('orienta o modelo Grok configurado a priorizar publicações do X', () => {
    const payload = buildWebResearchPayload('x-ai/grok', 'Voxen', 'x');
    expect(payload.model).toBe('x-ai/grok');
    expect(payload.messages[1]?.content).toContain('x.com');
  });
});

describe('selectResearchModel', () => {
  it('usa o modelo web e herda o modelo de chat quando ele não foi escolhido', () => {
    expect(selectResearchModel('web', { web: 'web/model', chat: 'chat/model', x: null })).toBe(
      'web/model',
    );
    expect(selectResearchModel('web', { web: null, chat: 'chat/model', x: null })).toBe(
      'chat/model',
    );
  });

  it('exige o modelo X dedicado sem cair no modelo de chat', () => {
    expect(selectResearchModel('x', { web: 'web/model', chat: 'chat/model', x: null })).toBeNull();
  });
});
