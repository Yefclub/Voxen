import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { buildCaptureMarkdown } from '../src/lib/capture/markdown';
import { generateOrganization, type OrganizationAnalysis } from '../src/lib/organization/generate';
import { organizationHash, type OrganizationEvidence } from '../src/lib/organization/source';
import type { GenerateStructuredInput } from '../src/lib/ai/client';
import { db } from '../src/lib/db';
import { publishOrganizationSection } from '../src/lib/organization/projection';
import { createSourceEvidenceManifest } from '../src/lib/source-provenance';

const relationship = 'Orion is part of the Vega project and documents its release process.';
const neutral =
  'This source describes routine release checks without a named project relationship.';

function fixture(text = neutral, summary = relationship) {
  const built = buildCaptureMarkdown({
    id: 'provenance-document',
    userId: 'owner',
    source: 'web',
    url: 'https://example.test/source',
    platformId: null,
    title: 'Release source',
    channel: null,
    author: null,
    durationSec: 0,
    publishedAt: null,
    thumbnail: null,
    language: 'en',
    method: 'scrape',
    model: 'fixture:model',
    costUsd: 0,
    transcribedAt: new Date('2026-11-14T02:00:00Z'),
    artifact: {
      version: 1,
      platform: 'web',
      submittedUrl: null,
      canonicalUrl: 'https://example.test/source',
      platformId: null,
      title: 'Release source',
      author: null,
      channel: null,
      publishedAt: null,
      durationSec: null,
      language: 'en',
      description: null,
      text,
      textKind: 'page',
      segments: [],
      hasAudio: false,
      images: [],
      extractor: 'fixture',
      imageDescriptions: [{ index: 0, description: relationship }],
      frameDescriptions: [{ timeSec: 3, description: relationship }],
      comments: [{ author: 'Audience member', text: relationship, likes: 1, publishedAt: null }],
    },
    interpretation: {
      title: 'Release source',
      language: 'en',
      summaryMd: summary,
      keyPoints: [relationship],
      tags: [],
      entities: [],
    },
  });
  const source = {
    id: 'provenance-document',
    userId: 'owner',
    title: 'Release source',
    sourceVersion: 1,
    sourceChecksum: 'source-checksum',
    correctionRevision: 0,
    correctionState: 'ACTIVE' as const,
    correctedChecksum: null as string | null,
    markdown: built.markdown,
    canonicalMarkdown: built.markdown,
    sourceMetadata: {
      producer: 'voxen-capture',
      evidenceManifest: built.evidenceManifest,
    } as Record<string, unknown>,
  };
  const calls: string[] = [];
  const published: OrganizationAnalysis[] = [];
  const input = {
    source,
    language: 'en' as const,
    signal: new AbortController().signal,
    checkpoint: async () => {},
    usage: { costUsd: 0, tokensIn: 0, tokensOut: 0, models: new Set<string>() },
    generate: async <T>(args: GenerateStructuredInput<T>) => {
      const body = JSON.parse((args.untrusted[0] as { text: string }).text).source as string;
      calls.push(body);
      return {
        output: args.schema.parse({
          reason: 'An explicitly quoted source relationship.',
          nodes: [
            { id: 'orion', name: 'Orion', kind: 'PRODUCT', quote: relationship },
            { id: 'vega', name: 'Vega', kind: 'PRODUCT', quote: relationship },
          ],
          relationships: [{ from: 'orion', to: 'vega', kind: 'PART_OF', quote: relationship }],
        }),
        modelRef: 'fixture:model',
        usage: { inputTokens: 20, outputTokens: 10 },
        costUsd: 0.0001,
      };
    },
    onSection: async (result: OrganizationAnalysis) => {
      published.push(result);
    },
  };
  return { built, source, calls, published, input };
}

describe('organization evidence authority', () => {
  test('does not promote generated summaries, visual descriptions or audience comments to source evidence', async () => {
    const f = fixture();
    await generateOrganization(f.input);
    expect(f.calls.join('\n')).not.toContain(relationship);
    expect(f.calls.join('\n')).toContain(neutral);
    expect(f.published.flatMap((row) => row.relationships)).toEqual([]);
  });

  test('anchors duplicated prose in the captured source instead of the earlier generated summary', async () => {
    const f = fixture(relationship);
    await generateOrganization(f.input);
    const evidence = f.published.flatMap((row) => row.relationships)[0]?.evidence;
    expect(evidence).toMatchObject({ excerpt: relationship, authority: 'CAPTURED_SOURCE' });
    expect(evidence!.startOffset).toBeGreaterThan(f.built.markdown.indexOf('## Conteúdo'));
    expect(f.built.markdown.slice(evidence!.startOffset, evidence!.endOffset)).toBe(relationship);
  });

  test('uses recorded spans when source content itself contains reserved-looking headings', async () => {
    const f = fixture(
      `## Resumo\n\n${relationship}\n\n## Comentários\n\nThis paragraph is part of the captured article.`,
      'An unrelated generated summary.',
    );
    await generateOrganization(f.input);
    expect(f.calls.join('\n')).toContain('This paragraph is part of the captured article.');
    expect(f.published.flatMap((row) => row.relationships)).toHaveLength(1);
  });

  test('does not promote a correction to a generated summary into captured-source authority', async () => {
    const f = fixture(neutral, 'A generated summary that initially describes routine checks.');
    f.source.markdown = f.built.markdown.replace(
      'A generated summary that initially describes routine checks.',
      relationship,
    );
    f.source.correctionRevision = 1;
    f.source.correctedChecksum = organizationHash(f.source.markdown);
    await generateOrganization(f.input);
    expect(f.calls.join('\n')).not.toContain(relationship);
    expect(f.published.flatMap((row) => row.relationships)).toEqual([]);
  });

  test('identifies an edited source passage as user-corrected and retains its actual new offsets', async () => {
    const f = fixture(neutral, 'A generated summary unrelated to project structure.');
    f.source.markdown = f.built.markdown.replace(neutral, relationship);
    f.source.correctionRevision = 1;
    f.source.correctedChecksum = organizationHash(f.source.markdown);
    await generateOrganization(f.input);
    const evidence = f.published.flatMap((row) => row.relationships)[0]?.evidence;
    expect(evidence).toMatchObject({ excerpt: relationship, authority: 'USER_CORRECTED' });
    expect(evidence!.startOffset).toBeGreaterThan(f.source.markdown.indexOf('## Conteúdo'));
  });

  test('requires valid publication provenance for older or tampered captures before model calls', async () => {
    const f = fixture(relationship);
    f.source.sourceMetadata = { producer: 'voxen-capture' };
    await expect(generateOrganization(f.input)).rejects.toThrow('SOURCE_PROVENANCE_UNAVAILABLE');
    expect(f.calls).toEqual([]);
    const g = fixture(relationship);
    g.source.canonicalMarkdown += '\nChanged immutable source.';
    await expect(generateOrganization(g.input)).rejects.toThrow('SOURCE_PROVENANCE_UNAVAILABLE');
    expect(g.calls).toEqual([]);
  });

  test('marks a quotation joined by deleting a source qualification as user-corrected', async () => {
    const split = relationship.indexOf('Vega');
    const first = relationship.slice(0, split).trimEnd(),
      last = relationship.slice(split);
    const original = `${first}\nThis is only an unverified hypothesis, not a factual source claim.\n${last}`;
    const f = fixture(original, 'A generated summary unrelated to project structure.');
    f.source.markdown = f.built.markdown.replace(original, `${first}\n${last}`);
    f.source.correctionRevision = 1;
    f.source.correctedChecksum = organizationHash(f.source.markdown);
    await generateOrganization(f.input);
    expect(f.published.flatMap((row) => row.relationships)[0]?.evidence).toMatchObject({
      authority: 'USER_CORRECTED',
    });
  });

  test('keeps many small corrections inside one bounded model window without dropping unchanged evidence', async () => {
    const original = `${Array.from({ length: 20 }, (_, i) => `Original source paragraph number ${i}.`).join('\n')}\n${relationship}`;
    const f = fixture(original, 'A generated summary unrelated to project structure.');
    f.source.markdown = f.built.markdown.replace(
      /Original source paragraph number /g,
      'Corrected source paragraph number ',
    );
    f.source.correctionRevision = 1;
    f.source.correctedChecksum = organizationHash(f.source.markdown);
    await generateOrganization(f.input);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toContain('Corrected source paragraph number 19.');
    expect(f.published.flatMap((row) => row.relationships)[0]?.evidence).toMatchObject({
      authority: 'CAPTURED_SOURCE',
      excerpt: relationship,
    });
  });

  test('rejects corrections that exceed the mapping budget before model calls', async () => {
    const original = Array.from(
      { length: 1100 },
      (_, i) => `Original unique source line ${i}.`,
    ).join('\n');
    const f = fixture(original, 'A generated summary unrelated to project structure.');
    f.source.markdown = f.built.markdown.replace(
      original,
      Array.from({ length: 1100 }, (_, i) => `Replacement unique source line ${i}.`).join('\n'),
    );
    f.source.correctionRevision = 1;
    f.source.correctedChecksum = organizationHash(f.source.markdown);
    await expect(generateOrganization(f.input)).rejects.toThrow('SOURCE_MAPPING_UNAVAILABLE');
    expect(f.calls).toEqual([]);
    expect(f.published).toEqual([]);
  });
});

const databaseSuite = process.env.DATABASE_URL ? describe : describe.skip;
databaseSuite('persisted organization evidence authority', () => {
  let userId = '';
  beforeAll(async () => {
    userId = (
      await db.user.create({
        data: {
          email: `organization-authority-${randomUUID()}@example.test`,
          name: 'Authority validation',
          status: 'APPROVED',
        },
      })
    ).id;
  });
  afterEach(async () => {
    await db.transcript.deleteMany({ where: { userId } });
    await db.brainNode.deleteMany({ where: { userId } });
  });
  afterAll(async () => {
    await db.user.delete({ where: { id: userId } });
  });
  async function savedFixture(text = relationship) {
    const f = fixture(text);
    f.source.id = `authority-${randomUUID()}`;
    f.source.userId = userId;
    f.source.correctionRevision = 1;
    f.source.correctedChecksum = organizationHash(f.source.markdown);
    await db.transcript.create({
      data: {
        id: f.source.id,
        userId,
        source: 'WEB',
        url: 'https://example.test/source',
        title: f.source.title,
        language: 'en',
        durationSec: 0,
        transcriptionMethod: 'SCRAPE',
        mdPath: 'authority-fixture.md',
        plainText: relationship,
        frontmatter: {},
        sourceVersion: 1,
        sourceChecksum: f.source.sourceChecksum,
        correctionRevision: 1,
        correctedMarkdown: f.source.markdown,
        correctedPlainText: relationship,
        correctedChecksum: f.source.correctedChecksum,
        sourceMetadata: { producer: 'voxen-capture', evidenceManifest: f.built.evidenceManifest },
      },
    });
    return f;
  }
  test('records captured authority with real source anchors and rejects a forged summary-span manifest', async () => {
    const f = await savedFixture();
    await generateOrganization(f.input);
    const analysis = f.published[0]!;
    await publishOrganizationSection({
      source: f.source,
      analysis,
      assertCurrent: async () => {},
      commit: async () => {},
    });
    const sources = await db.brainSource.findMany({
      where: {
        userId,
        sourceType: 'TRANSCRIPT',
        sourceId: f.source.id,
        edge: { method: 'llm-grounded-organization' },
      },
    });
    expect(sources.length).toBeGreaterThan(0);
    expect(
      sources.every(
        (source) =>
          source.authority === 'CAPTURED_SOURCE' &&
          source.startLine! >
            f.source.markdown.slice(0, f.source.markdown.indexOf('## Conteúdo')).split('\n').length,
      ),
    ).toBeTrue();
    const firstSummaryQuote = f.source.markdown.indexOf(relationship);
    f.source.sourceMetadata = {
      producer: 'voxen-capture',
      evidenceManifest: createSourceEvidenceManifest(f.source.markdown, [
        { start: firstSummaryQuote, end: firstSummaryQuote + relationship.length },
      ]),
    };
    f.published.length = 0;
    await generateOrganization(f.input);
    await expect(
      publishOrganizationSection({
        source: f.source,
        analysis: f.published[0]!,
        assertCurrent: async () => {},
        commit: async () => {},
      }),
    ).rejects.toThrow('STALE_SOURCE');
    expect(await db.brainSource.count({ where: { userId, sourceId: f.source.id } })).toBe(
      sources.length,
    );
  });
  test('rejects a caller that changes the verified authority of a source excerpt', async () => {
    const f = await savedFixture();
    await generateOrganization(f.input);
    const analysis = f.published[0]!;
    analysis.nodes[0]!.evidence.authority = 'PREPARED_DOCUMENT';
    await expect(
      publishOrganizationSection({
        source: f.source,
        analysis,
        assertCurrent: async () => {},
        commit: async () => {},
      }),
    ).rejects.toThrow('INVALID_EVIDENCE');
    expect(await db.brainSource.count({ where: { userId } })).toBe(0);
  });

  test('does not treat absent authority as verification of an ineligible generated-summary excerpt', async () => {
    const f = await savedFixture(neutral);
    await generateOrganization(f.input);
    const startOffset = f.source.markdown.indexOf(relationship);
    const startLine = f.source.markdown.slice(0, startOffset).split('\n').length;
    const evidence: OrganizationEvidence = {
      excerpt: relationship,
      startOffset,
      endOffset: startOffset + relationship.length,
      startLine,
      endLine: startLine,
      authority: null as unknown as OrganizationEvidence['authority'],
    };
    const analysis: OrganizationAnalysis = {
      sectionKey: f.published[0]!.sectionKey,
      reason: 'Malformed replay payload',
      warnings: [],
      nodes: [
        { id: 'orion', name: 'Orion', kind: 'PRODUCT', evidence },
        { id: 'vega', name: 'Vega', kind: 'PRODUCT', evidence },
      ],
      relationships: [{ from: 'orion', to: 'vega', kind: 'PART_OF', evidence }],
    };
    await expect(
      publishOrganizationSection({
        source: f.source,
        analysis,
        assertCurrent: async () => {},
        commit: async () => {},
      }),
    ).rejects.toThrow('INVALID_EVIDENCE');
    expect(await db.brainSource.count({ where: { userId } })).toBe(0);
  });
});
