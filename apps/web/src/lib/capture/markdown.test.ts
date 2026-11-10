import { describe, expect, test } from 'bun:test';
import { sanitizeModelText, stripImages } from './markdown';

describe('sanitizeModelText', () => {
  test.each([
    ['![a [b] c](//evil.example/p.png) texto', 'evil.example'],
    ['[click [here]](//evil.example) agora', 'evil.example'],
    ['![x][1] e mais\n\n[1]: //evil.example/pixel.png', 'evil.example'],
    ['[ok](https://evil.example/a?b=c) fim', 'evil.example'],
    ['veja <img src="https://evil.example/p.gif"> isso', 'evil.example'],
    ['link cru https://evil.example/x e www.evil.example', 'evil.example'],
    ['[a](javascript:alert(1)) b', 'javascript'],
    ['![img](data:image/png;base64,AAAA) b', 'data:'],
  ])('removes links and images from %p', (input, forbidden) => {
    const out = sanitizeModelText(input);
    expect(out).not.toContain(forbidden);
    expect(out).not.toMatch(/!\[|\]\(|\]\[/);
  });

  test('never leaves a raw tag opener behind nested tags', () => {
    const out = sanitizeModelText('a <scr<script>ipt>alert(1)</script> b');
    expect(out).not.toMatch(/<[a-z/]/i);
  });

  test('keeps the readable text of links and plain prose', () => {
    expect(sanitizeModelText('Leia [o guia oficial](https://x.example) com **calma**.')).toBe(
      'Leia o guia oficial com **calma**.',
    );
  });
});

describe('stripImages', () => {
  test('neutralizes inline, nested and reference images in captured bodies', () => {
    const body =
      '![a [b]](//t.example/p.png)\n![r][1]\n\n[1]: //t.example/q.png\n[link](https://ok.example)';
    const out = stripImages(body);
    expect(out).not.toMatch(/!\[/);
    expect(out).toContain('[link](https://ok.example)');
  });
});
