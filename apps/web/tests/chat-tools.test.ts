import { describe, expect, it } from 'bun:test';
import { buildTools } from '../src/lib/chat/runtime';

describe('buildTools (agente in-app)', () => {
  const tools = buildTools('user-test');
  const names = Object.keys(tools);

  it('expõe as ferramentas do fluxo progressivo', () => {
    for (const name of [
      'search_transcripts',
      'outline_transcript',
      'read_lines',
      'read_section',
      'read_timespan',
      'expand_context',
      'related',
      'verify_citations',
      'read_transcript',
    ]) {
      expect(names).toContain(name);
    }
  });

  it('mantém as ferramentas de notas e Brain', () => {
    for (const name of ['search_notes', 'read_note', 'brain_search', 'propose_create_note']) {
      expect(names).toContain(name);
    }
  });

  it('cada ferramenta tem inputSchema e execute', () => {
    for (const name of names) {
      const t = tools[name as keyof typeof tools] as {
        inputSchema?: unknown;
        execute?: unknown;
      };
      expect(t.inputSchema).toBeDefined();
      expect(typeof t.execute).toBe('function');
    }
  });
});
