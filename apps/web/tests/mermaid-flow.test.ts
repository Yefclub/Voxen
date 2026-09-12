import { describe, expect, it } from 'bun:test';
import {
  hasUnsafeMermaidCssUrl,
  MAX_MERMAID_FLOW_NODES,
  validateMermaidFlow,
} from '../src/shared/mermaid-flow';
import { buildTranscriptFlowPrompt, hasValidMermaidSyntax } from '../src/lib/transcript-flow';

describe('Mermaid transcript flow contract', () => {
  it('accepts and normalizes a bounded flowchart fence', () => {
    const result = validateMermaidFlow(
      `\n\`\`\`mermaid\nflowchart TD\n  N1[Input] --> N2{Valid?}\n  N2 --> N3[Store]\n\`\`\`\n`,
    );
    expect(result).toEqual({
      ok: true,
      code: 'flowchart TD\n  N1[Input] --> N2{Valid?}\n  N2 --> N3[Store]',
      nodeCount: 3,
    });
  });

  it.each([
    ['init directive', 'flowchart TD\n%%{init: {"securityLevel":"loose"}}%%\nA-->B'],
    ['click callback', 'flowchart TD\nA-->B\nclick A callback'],
    ['external URL', 'flowchart TD\nA[https://example.com]-->B'],
    ['HTML label', 'flowchart TD\nA[hello<br/>world]-->B'],
    ['image shape', 'flowchart TD\nA@{ img: "x" }-->B'],
  ])('rejects unsafe %s', (_label, source) => {
    expect(validateMermaidFlow(source)).toEqual({ ok: false, error: 'MERMAID_FLOW_UNSAFE' });
  });

  it.each([
    ['scheme-relative URL', 'style A fill:url(//attacker.test/pixel)'],
    ['relative URL', 'classDef leak fill:url(/pixel)'],
    ['comment-obfuscated URL', 'linkStyle 0 stroke:url/**/(//attacker.test/pixel)'],
    ['escaped URL', 'style A fill:u\\72l(//attacker.test/pixel)'],
  ])('rejects style directives before rendering: %s', (_label, directive) => {
    expect(validateMermaidFlow(`flowchart TD\nA[Test] --> B[Done]\n${directive}`)).toEqual({
      ok: false,
      error: 'MERMAID_FLOW_UNSAFE',
    });
  });

  it('allows local SVG fragment references and rejects external CSS URLs', () => {
    expect(hasUnsafeMermaidCssUrl('stroke:url(#flow-gradient)')).toBe(false);
    expect(hasUnsafeMermaidCssUrl('fill: url("#node.marker")')).toBe(false);
    expect(hasUnsafeMermaidCssUrl('fill:url(https://evil.test/image.svg)')).toBe(true);
    expect(hasUnsafeMermaidCssUrl('fill:url("data:image/svg+xml,test")')).toBe(true);
  });

  it('rejects unsupported diagrams and empty node sets', () => {
    expect(validateMermaidFlow('sequenceDiagram\nA->>B: hello')).toEqual({
      ok: false,
      error: 'MERMAID_FLOW_TYPE_UNSUPPORTED',
    });
    expect(validateMermaidFlow('flowchart TD')).toEqual({
      ok: false,
      error: 'MERMAID_FLOW_NODES_MISSING',
    });
  });

  it.each([
    ['unterminated node', 'flowchart TD\nN1[unterminated'],
    ['mismatched node', 'flowchart TD\nN1[wrong)'],
    ['unterminated edge label', 'flowchart TD\nN1[Start] -->|yes N2[Done]'],
    ['unknown statement', 'flowchart TD\nN1[Start] random N2[Done]'],
    ['unsupported source directive', 'flowchart TD\nsubgraph Internal\nN1[Start]\nend'],
  ])('rejects malformed safe-subset syntax: %s', (_label, source) => {
    expect(validateMermaidFlow(source)).toEqual({
      ok: false,
      error: 'MERMAID_FLOW_SYNTAX_INVALID',
    });
  });

  it('accepts bounded decisions, labelled edges, and safe statement separators', () => {
    expect(
      validateMermaidFlow(
        "flowchart LR\nN1[User's input]; N1 --> N2{Valid?}\nN2 -->|Yes| N3[Store]\nN2 -.-> N4[Review]",
      ),
    ).toEqual({
      ok: true,
      code: "flowchart LR\nN1[User's input]; N1 --> N2{Valid?}\nN2 -->|Yes| N3[Store]\nN2 -.-> N4[Review]",
      nodeCount: 4,
    });
  });

  it.each([
    ['reserved end token', 'flowchart TD\nend'],
    ['incomplete subgraph', 'flowchart TD\nsubgraph'],
    ['invalid nested square shape', 'flowchart TD\nA[foo[bar]]'],
  ])('uses an isolated official parser before persistence: %s', async (_label, source) => {
    expect(await hasValidMermaidSyntax(source)).toBe(false);
  });

  it('rejects diagrams above the node bound', () => {
    const nodes = Array.from(
      { length: MAX_MERMAID_FLOW_NODES + 1 },
      (_, index) => `N${index}[Node ${index}]`,
    ).join('\n');
    expect(validateMermaidFlow(`flowchart TD\n${nodes}`)).toEqual({
      ok: false,
      error: 'MERMAID_FLOW_TOO_MANY_NODES',
    });
  });

  it('keeps prompt labels localized and forbids active content', () => {
    expect(buildTranscriptFlowPrompt('en')).toContain('English labels');
    expect(buildTranscriptFlowPrompt('pt-BR')).toContain('português brasileiro');
    for (const prompt of [buildTranscriptFlowPrompt('en'), buildTranscriptFlowPrompt('pt-BR')]) {
      expect(prompt).toContain('Do not use click');
      expect(prompt).toContain('external resources');
    }
  });

  it('wires a lazy strict renderer, transcript UI, and read tools', async () => {
    const [markdown, page, blocks, mcp, chat, schema, migration, pkg] = await Promise.all([
      Bun.file(new URL('../src/client/components/ui/markdown.tsx', import.meta.url)).text(),
      Bun.file(new URL('../src/client/pages/transcricoes-detalhe.tsx', import.meta.url)).text(),
      Bun.file(
        new URL('../src/client/components/library/transcript-derived-content.tsx', import.meta.url),
      ).text(),
      Bun.file(new URL('../src/routes/mcp.ts', import.meta.url)).text(),
      Bun.file(new URL('../src/lib/chat/runtime.ts', import.meta.url)).text(),
      Bun.file(new URL('../../../prisma/schema.prisma', import.meta.url)).text(),
      Bun.file(
        new URL(
          '../../../prisma/migrations/20260808190000_transcript_mermaid_flow/migration.sql',
          import.meta.url,
        ),
      ).text(),
      Bun.file(new URL('../package.json', import.meta.url)).json(),
    ]);

    expect(pkg.dependencies.mermaid).toBe('11.16.1');
    expect(pkg.dependencies.dompurify).toBe('3.4.13');
    expect(markdown).toContain("await import('mermaid')");
    expect(markdown).toContain("securityLevel: 'strict'");
    expect(markdown).toContain('validateMermaidFlow(source)');
    expect(markdown).toContain('script, foreignObject, iframe, image, a, object, embed');
    expect(markdown).toContain('touch-pan-x touch-pan-y');
    expect(page).toContain('/flow`');
    expect(page).toContain('<TranscriptFlowBlock');
    expect(page).toContain('readOnly={!canUseContextualActions}');
    expect(blocks).toContain('\\`\\`\\`mermaid');
    expect(mcp).toContain('flowchart: t.flowchartMd ?? null');
    expect(chat).toContain('flowchart: transcript.flowchartMd');
    expect(schema).toContain('flowchartMd');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "flowchartMd" TEXT');
  });
});
