import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const panelSource = readFileSync(new URL('./chat-sources-panel.tsx', import.meta.url), 'utf8');
const markdownSource = readFileSync(new URL('../ui/markdown.tsx', import.meta.url), 'utf8');
const chatSource = readFileSync(new URL('../../pages/chat.tsx', import.meta.url), 'utf8');

describe('chat reference canvas contract', () => {
  test('source cards select an in-app reference instead of navigating directly', () => {
    expect(panelSource).toContain('onClick={() => onSelect(citation)}');
    expect(panelSource).not.toContain('href={citation.href}\n            className');
  });

  test('inline citations delegate primary activation to the chat canvas', () => {
    expect(markdownSource).toContain('onClick={() => onOpen(citation)}');
    expect(chatSource).toContain('onCitationOpen={(citation) =>');
    expect(chatSource).toContain('setSelectedSourceCitation(citation)');
  });

  test('the canvas uses the authenticated transcript endpoint and keeps full navigation explicit', () => {
    expect(panelSource).toContain('/api/transcripts/${encodeURIComponent(citation.sourceId)}');
    expect(panelSource).toContain('target="_blank"');
    expect(panelSource).toContain('stripMarkdownFrontmatter(data.markdown)');
  });
});
