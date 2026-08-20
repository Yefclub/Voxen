import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { ChatCitation } from '../../../shared/chat-citations';
import { citationCanvasKey, citationCanvasState } from '../../lib/chat-reference-canvas';

const panelSource = readFileSync(new URL('./chat-sources-panel.tsx', import.meta.url), 'utf8');
const markdownSource = readFileSync(new URL('../ui/markdown.tsx', import.meta.url), 'utf8');
const chatSource = readFileSync(new URL('../../pages/chat.tsx', import.meta.url), 'utf8');

const citation = (overrides: Partial<ChatCitation> = {}): ChatCitation => ({
  sourceType: 'TRANSCRIPT',
  sourceId: 'source-a',
  title: 'Source A',
  quote: 'Evidence A',
  context: null,
  fromLine: 12,
  toLine: 14,
  fromSec: null,
  toSec: null,
  href: '/transcricoes/source-a',
  kind: 'EVIDENCE',
  verified: true,
  inlineOrdinal: 1,
  ...overrides,
});

describe('chat reference canvas contract', () => {
  test('source cards select an in-app reference instead of navigating directly', () => {
    expect(panelSource).toContain('onClick={() => onSelect(citation)}');
    expect(panelSource).toContain("citation.sourceType === 'WEB'");
    expect(panelSource).toContain('target="_blank"');
  });

  test('inline citations delegate primary activation to the chat canvas', () => {
    expect(markdownSource).toContain('onClick={() => onOpen(citation)}');
    expect(markdownSource).toContain("citation.sourceType === 'WEB'");
    expect(chatSource).toContain('onCitationOpen={(citation) =>');
    expect(chatSource).toContain('setSelectedSourceCitation(citation)');
  });

  test('the canvas uses the authenticated transcript endpoint and keeps full navigation explicit', () => {
    expect(panelSource).toContain('/api/transcripts/${encodeURIComponent(citation.sourceId)}');
    expect(panelSource).toContain('target="_blank"');
    expect(panelSource).toContain('stripMarkdownFrontmatter(data.markdown)');
  });

  test('switching references remounts the canvas before new content is requested', () => {
    expect(citationCanvasKey(citation())).not.toBe(
      citationCanvasKey(citation({ sourceId: 'missing-source' })),
    );
    expect(panelSource).toContain('key={citationCanvasKey(selectedCitation)}');
  });

  test('preserves verified, unverified and stale evidence semantics', () => {
    expect(citationCanvasState(citation())).toBe('verified');
    expect(citationCanvasState(citation({ verified: false }))).toBe('unverified');
    expect(citationCanvasState(citation({ kind: 'INFERENCE' }))).toBe('unverified');
    expect(citationCanvasState(citation({ stale: true }))).toBe('stale');
  });

  test('mobile canvas keeps an accessible sheet title and reserves the close control', () => {
    expect(panelSource).toContain('<SheetTitle className=');
    expect(panelSource).toContain("mobile && 'pr-12'");
  });
});
