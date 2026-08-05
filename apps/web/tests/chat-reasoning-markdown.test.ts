import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const chat = readFileSync(new URL('../src/client/pages/chat.tsx', import.meta.url), 'utf8');
const markdown = readFileSync(
  new URL('../src/client/components/ui/markdown.tsx', import.meta.url),
  'utf8',
);

describe('chat reasoning markdown', () => {
  test('renders reasoning segments through the streaming-safe Markdown component', () => {
    const thinkingBlock = chat.slice(
      chat.indexOf('function ThinkingBlock'),
      chat.indexOf('function MessageCopyButton'),
    );

    expect(thinkingBlock).toContain('<Markdown');
    expect(thinkingBlock).toContain('segment.text');
    expect(thinkingBlock).toContain("t('chat.reasoningInProgress')");
    expect(thinkingBlock).not.toContain('<p\n                key={segment.id}');
  });

  test('keeps the shared renderer hardened against raw HTML', () => {
    expect(markdown).toContain('<Streamdown parseIncompleteMarkdown');
    expect(markdown).not.toContain('rehypeRaw');
    expect(markdown).not.toContain('plugins={{');
  });
});
