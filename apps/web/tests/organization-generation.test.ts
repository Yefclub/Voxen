import { describe, expect, test } from 'bun:test';
import { AiError } from '../src/lib/ai/errors';
import type { GenerateStructuredInput } from '../src/lib/ai/client';
import {
  generateOrganization,
  type OrganizationAnalysis,
  type OrganizationUsage,
} from '../src/lib/organization/generate';
import { organizationSections, organizationSnapshot } from '../src/lib/organization/source';

const quote = 'Orion is part of the Vega project and documents its release process.';
const answer = {
  reason: 'The source explicitly identifies the project relationship.',
  nodes: [
    { id: 'orion', name: 'Orion', kind: 'PRODUCT', quote },
    { id: 'vega', name: 'Vega', kind: 'PRODUCT', quote },
  ],
  relationships: [{ from: 'orion', to: 'vega', kind: 'PART_OF', quote }],
};

function fixture(markdown = `# Release process\n\n${quote}\n`) {
  const source = {
    id: 'document',
    userId: 'owner',
    title: 'Release process',
    sourceVersion: 2,
    sourceChecksum: 'canonical-checksum',
    correctionRevision: 1,
    correctionState: 'ACTIVE' as const,
    correctedChecksum: 'corrected-checksum',
    markdown,
    canonicalMarkdown: null,
    sourceMetadata: {},
  };
  const usage: OrganizationUsage = {
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    models: new Set(),
  };
  const calls: GenerateStructuredInput<unknown>[] = [];
  const published: OrganizationAnalysis[] = [];
  let currentAnswer = answer;
  const generate = async <T>(input: GenerateStructuredInput<T>) => {
    calls.push(input);
    return {
      output: input.schema.parse(currentAnswer),
      modelRef: 'fixture:model',
      usage: { inputTokens: 80, outputTokens: 40 },
      costUsd: 0.0002,
    };
  };
  const input = {
    source,
    language: 'en' as const,
    signal: new AbortController().signal,
    checkpoint: async () => {},
    usage,
    generate,
    onSection: async (result: OrganizationAnalysis) => {
      published.push(result);
    },
  };
  return {
    source,
    usage,
    calls,
    published,
    input,
    setAnswer: (next: typeof answer) => (currentAnswer = next),
  };
}

describe('source-grounded organization generation', () => {
  test('publishes source excerpts and actual source line anchors without tools', async () => {
    const f = fixture();
    await generateOrganization(f.input);
    expect(f.published).toHaveLength(1);
    expect(f.published[0]?.nodes.map((node) => node.name)).toEqual(['Orion', 'Vega']);
    expect(f.published[0]?.relationships[0]).toMatchObject({
      from: 'orion',
      to: 'vega',
      kind: 'PART_OF',
      evidence: { excerpt: quote, startLine: 3, endLine: 3 },
    });
    expect(f.calls[0]).not.toHaveProperty('tools');
    expect(f.calls[0]?.instructions).toContain('untrusted');
    expect(f.usage).toMatchObject({ costUsd: 0.0002, tokensIn: 80, tokensOut: 40 });
    expect([...f.usage.models]).toEqual(['fixture:model']);
  });

  test('omits fabricated nodes, unknown endpoints and quotes that do not support both names', async () => {
    const f = fixture();
    f.setAnswer({
      ...answer,
      nodes: [...answer.nodes, { id: 'fake', name: 'Invented', kind: 'PRODUCT', quote }],
      relationships: [
        ...answer.relationships,
        { from: 'orion', to: 'fake', kind: 'PART_OF', quote },
        { from: 'orion', to: 'missing', kind: 'PART_OF', quote },
        {
          from: 'orion',
          to: 'vega',
          kind: 'RELATED_TO',
          quote: 'This fabricated quotation is not present in the source.',
        },
      ],
    });
    await generateOrganization(f.input);
    expect(f.published[0]?.nodes).toHaveLength(2);
    expect(f.published[0]?.relationships).toHaveLength(1);
    expect(f.published[0]?.warnings).toContain('UNSUPPORTED_NODE');
    expect(f.published[0]?.warnings).toContain('UNSUPPORTED_RELATIONSHIP');
    const onlyOrion = 'Orion documents the release process and its qualification requirements.';
    const g = fixture(`${quote}\n${onlyOrion}`);
    g.setAnswer({ ...answer, relationships: [{ ...answer.relationships[0]!, quote: onlyOrion }] });
    await generateOrganization(g.input);
    expect(g.published[0]?.relationships).toEqual([]);
  });

  test('analyzes the middle of long sources and preserves Unicode and whitespace anchors', async () => {
    const prefix = `${'Opening paragraph.\n'.repeat(3600)}😀\n`;
    const wrapped = quote.replace('Vega project', 'Vega\nproject');
    const f = fixture(`${prefix}${wrapped}\n${'Closing paragraph.\n'.repeat(3600)}`);
    f.input.generate = async <T>(input: GenerateStructuredInput<T>) => {
      f.calls.push(input);
      const body = input.untrusted.map((part) => ('text' in part ? part.text : '')).join('');
      return {
        output: input.schema.parse(
          body.includes('Orion is part')
            ? answer
            : { reason: 'No supported named relationship.', nodes: [], relationships: [] },
        ),
        modelRef: 'fixture:model',
        usage: { inputTokens: 10, outputTokens: 5 },
        costUsd: 0.0001,
      };
    };
    await generateOrganization(f.input);
    expect(f.calls.length).toBeGreaterThan(2);
    const relation = f.published.flatMap((row) => row.relationships)[0];
    expect(relation?.evidence).toMatchObject({
      excerpt: wrapped,
      startLine: prefix.split('\n').length,
      endLine: prefix.split('\n').length + 1,
    });
    const actualInputs = f.calls.map(
      (call) => JSON.parse((call.untrusted[0] as { text: string }).text).source as string,
    );
    expect(actualInputs.join('')).toBe(f.source.markdown);
    expect(
      actualInputs.every(
        (text) =>
          !/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(text),
      ),
    ).toBeTrue();
  });

  test('validates the complete source capacity before any model call', async () => {
    const f = fixture('x'.repeat(48_000 * 24 + 1));
    await expect(generateOrganization(f.input)).rejects.toMatchObject({ code: 'TEXT_TOO_LARGE' });
    expect(f.calls).toEqual([]);
    expect(f.published).toEqual([]);
  });

  test('bounds actual 48,001–60,000 unit inputs and never splits Unicode pairs', async () => {
    const text = `${'x'.repeat(47_999)}😀${quote}${'y'.repeat(3000)}`;
    const f = fixture(text);
    await generateOrganization(f.input);
    const inputs = f.calls.map(
      (call) => JSON.parse((call.untrusted[0] as { text: string }).text).source as string,
    );
    expect(inputs).toHaveLength(2);
    expect(inputs.every((input) => input.length <= 48_000)).toBeTrue();
    expect(inputs.join('')).toBe(text);
    expect(
      inputs.every(
        (input) =>
          !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(input),
      ),
    ).toBeTrue();
  });

  test('stops after cancellation and never publishes an answer after lease loss', async () => {
    const f = fixture();
    let current = true;
    f.input.checkpoint = async () => {
      if (!current) throw new Error('LEASE_LOST');
    };
    const generate = f.input.generate;
    f.input.generate = async (input) => {
      const result = await generate(input);
      current = false;
      return result;
    };
    await expect(generateOrganization(f.input)).rejects.toThrow('LEASE_LOST');
    expect(f.published).toEqual([]);
    expect(f.usage.costUsd).toBe(0.0002);
    const controller = new AbortController();
    controller.abort();
    const g = fixture();
    await expect(generateOrganization({ ...g.input, signal: controller.signal })).rejects.toThrow();
    expect(g.calls).toEqual([]);
  });

  test('reuses durable completed sections and retains billed failure cost', async () => {
    const f = fixture(`${'opening\n'.repeat(8000)}${quote}\n`);
    const sections = organizationSections(f.source);
    await generateOrganization({ ...f.input, completed: new Set([sections[0]!.key]) });
    expect(f.published.map((row) => row.sectionKey)).toEqual(
      sections.slice(1).map((section) => section.key),
    );
    const g = fixture();
    g.input.generate = async () => {
      const error = new AiError('LLM_FAILED', 'Unavailable', { retryable: true });
      error.costUsd = 0.0004;
      throw error;
    };
    await expect(generateOrganization(g.input)).rejects.toThrow();
    expect(g.usage.costUsd).toBe(0.0004);
    expect(g.published).toEqual([]);
  });

  test('fences changes to source, correction, title and effective text in the snapshot', () => {
    const f = fixture();
    const original = organizationSnapshot(f.source);
    for (const changes of [
      { sourceVersion: 3 },
      { correctionRevision: 2 },
      { correctionState: 'STALE' as const },
      { title: 'Changed' },
      { markdown: 'Changed source text' },
    ])
      expect(organizationSnapshot({ ...f.source, ...changes })).not.toEqual(original);
  });
});
