import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import { generateOrganization, type OrganizationAnalysis } from '../src/lib/organization/generate';
import { publishOrganizationSection } from '../src/lib/organization/projection';
import { organizationHash, type OrganizationSource } from '../src/lib/organization/source';

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const quote = 'Orion is part of the Vega project and documents its release process.';
const markdown = `# Release process\n\n${quote}\n`;
const users: string[] = [];

suite('atomic source-grounded graph organization', () => {
  beforeAll(async () => {
    for (let i = 0; i < 2; i++)
      users.push(
        (
          await db.user.create({
            data: {
              email: `organization-projection-${randomUUID()}@example.test`,
              name: 'Organization projection',
              status: 'APPROVED',
            },
          })
        ).id,
      );
  });
  afterEach(async () => {
    await db.transcript.deleteMany({ where: { userId: { in: users } } });
    await db.brainNode.deleteMany({ where: { userId: { in: users } } });
    await db.tag.deleteMany({ where: { userId: { in: users } } });
    await db.libraryFolder.deleteMany({ where: { userId: { in: users } } });
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: users } } });
  });
  async function fixture(passage = quote, names: [string, string] = ['Orion', 'Vega']) {
    const body = `# Release process\n\n${passage}\n`;
    const folder = await db.libraryFolder.create({
      data: { userId: users[0]!, name: 'Manual folder' },
    });
    const row = await db.transcript.create({
      data: {
        userId: users[0]!,
        folderId: folder.id,
        source: 'WEB',
        url: 'https://example.test/original',
        title: 'Release process',
        durationSec: 0,
        language: 'en',
        transcriptionMethod: 'SCRAPE',
        mdPath: 'not-read-for-active-overlay.md',
        frontmatter: {},
        plainText: 'Canonical source stays unchanged.',
        summaryMd: 'Original summary stays unchanged.',
        sourceVersion: 2,
        sourceChecksum: 'canonical-checksum',
        correctionRevision: 1,
        correctedMarkdown: body,
        correctedPlainText: passage,
        correctedChecksum: organizationHash(body),
      },
    });
    const tag = await db.tag.upsert({
      where: { userId_slug: { userId: users[0]!, slug: 'manual-tag' } },
      update: { transcripts: { create: { transcriptId: row.id } } },
      create: {
        userId: users[0]!,
        name: 'Manual tag',
        slug: 'manual-tag',
        transcripts: { create: { transcriptId: row.id } },
      },
    });
    const source: OrganizationSource = { ...row, markdown: body, canonicalMarkdown: null };
    async function analyze(analysisSource: OrganizationSource = source) {
      let analysis!: OrganizationAnalysis;
      await generateOrganization({
        source: analysisSource,
        language: 'en',
        signal: new AbortController().signal,
        checkpoint: async () => {},
        usage: { costUsd: 0, tokensIn: 0, tokensOut: 0, models: new Set() },
        generate: async (input) => ({
          output: input.schema.parse({
            reason: 'An explicit project relationship.',
            nodes: [
              { id: 'orion', name: names[0], kind: 'PRODUCT', quote: passage },
              { id: 'vega', name: names[1], kind: 'PRODUCT', quote: passage },
            ],
            relationships: [{ from: 'orion', to: 'vega', kind: 'PART_OF', quote: passage }],
          }),
          modelRef: 'fixture:model',
          usage: { inputTokens: 0, outputTokens: 0 },
          costUsd: 0,
        }),
        onSection: async (result) => {
          analysis = result;
        },
      });
      return analysis;
    }
    const analysis = await analyze();
    const input = { source, analysis, assertCurrent: async () => {}, commit: async () => {} };
    return { row, tag, folder, source, analysis, input, analyze };
  }

  test('publishes verified relationships idempotently and preserves manually named identities and organization', async () => {
    const f = await fixture();
    const manual = await db.brainNode.create({
      data: {
        userId: users[0]!,
        key: 'ENTITY:legacy:orion',
        type: 'ENTITY',
        label: 'Orion',
        description: 'My own description',
        metadata: { method: 'manual', entityType: 'PRODUCT' },
      },
    });
    const vega = await db.brainNode.create({
      data: {
        userId: users[0]!,
        key: 'ENTITY:product:vega',
        type: 'ENTITY',
        label: 'Vega',
        metadata: { method: 'manual', entityType: 'PRODUCT' },
      },
    });
    const manualEdge = await db.brainEdge.create({
      data: {
        userId: users[0]!,
        fromNodeId: manual.id,
        toNodeId: vega.id,
        kind: 'RELATED_TO',
        method: 'manual',
        metadata: { label: 'My own connection' },
      },
    });
    await publishOrganizationSection(f.input);
    const first = await db.brainSource.count({ where: { userId: users[0]! } });
    await publishOrganizationSection(f.input);
    expect(await db.brainSource.count({ where: { userId: users[0]! } })).toBe(first);
    const relation = await db.brainEdge.findFirstOrThrow({
      where: { userId: users[0]!, kind: 'PART_OF', method: 'llm-grounded-organization' },
      include: { sources: true },
    });
    expect(relation.fromNodeId).toBe(manual.id);
    expect(relation.sources[0]).toMatchObject({
      sourceId: f.row.id,
      sourceType: 'TRANSCRIPT',
      excerpt: quote,
      startLine: 3,
      endLine: 3,
      authority: 'USER_CORRECTED',
    });
    expect(relation.sources[0]?.segmentKey).toContain('source:2:correction:1:');
    expect(await db.brainNode.findUniqueOrThrow({ where: { id: manual.id } })).toMatchObject({
      label: 'Orion',
      description: 'My own description',
      metadata: { method: 'manual', entityType: 'PRODUCT' },
    });
    expect(await db.brainEdge.findUniqueOrThrow({ where: { id: manualEdge.id } })).toMatchObject({
      method: 'manual',
      metadata: { label: 'My own connection' },
    });
    expect(await db.transcript.findUniqueOrThrow({ where: { id: f.row.id } })).toMatchObject({
      title: f.row.title,
      plainText: f.row.plainText,
      summaryMd: f.row.summaryMd,
      folderId: f.folder.id,
      correctedMarkdown: markdown,
    });
    expect(
      await db.transcriptTag.count({ where: { transcriptId: f.row.id, tagId: f.tag.id } }),
    ).toBe(1);
  });

  test('reuses an owned active alias without using foreign or archived evidence', async () => {
    const f = await fixture();
    const target = await db.brainNode.create({
      data: {
        userId: users[0]!,
        key: 'ENTITY:product:canonical-orion',
        type: 'ENTITY',
        label: 'Orion Project',
        metadata: { entityType: 'PRODUCT' },
      },
    });
    await db.brainEntityAlias.create({
      data: {
        userId: users[0]!,
        entityNodeId: target.id,
        alias: 'Orion',
        normalizedAlias: 'orion',
        entityType: 'PRODUCT',
        sourceType: 'TRANSCRIPT',
        sourceId: f.row.id,
        evidenceKey: randomUUID(),
      },
    });
    const foreign = await db.brainNode.create({
      data: { userId: users[1]!, key: 'ENTITY:product:orion', type: 'ENTITY', label: 'Orion' },
    });
    const archived = await db.transcript.create({
      data: {
        userId: users[0]!,
        status: 'ARCHIVED',
        source: 'WEB',
        url: 'https://example.test/archived',
        title: 'Archived source',
        durationSec: 0,
        language: 'en',
        transcriptionMethod: 'SCRAPE',
        mdPath: 'unused.md',
        plainText: quote,
        frontmatter: {},
      },
    });
    const obsolete = await db.brainNode.create({
      data: {
        userId: users[0]!,
        key: 'ENTITY:product:archived-orion',
        type: 'ENTITY',
        label: 'Archived Orion',
        metadata: { entityType: 'PRODUCT' },
      },
    });
    await db.brainEntityAlias.create({
      data: {
        userId: users[0]!,
        entityNodeId: obsolete.id,
        alias: 'Orion',
        normalizedAlias: 'orion',
        entityType: 'PRODUCT',
        sourceType: 'TRANSCRIPT',
        sourceId: archived.id,
        evidenceKey: randomUUID(),
      },
    });
    await publishOrganizationSection(f.input);
    const relation = await db.brainEdge.findFirstOrThrow({
      where: { userId: users[0]!, kind: 'PART_OF' },
    });
    expect(relation.fromNodeId).toBe(target.id);
    expect(relation.fromNodeId).not.toBe(foreign.id);
    expect(await db.brainSource.count({ where: { userId: users[1]! } })).toBe(0);
  });

  test('keeps ambiguous aliases separate and reports the unresolved identity', async () => {
    const f = await fixture();
    for (const suffix of ['a', 'b']) {
      const node = await db.brainNode.create({
        data: {
          userId: users[0]!,
          key: `ENTITY:product:orion-${suffix}`,
          type: 'ENTITY',
          label: `Orion ${suffix}`,
          metadata: { entityType: 'PRODUCT' },
        },
      });
      await db.brainEntityAlias.create({
        data: {
          userId: users[0]!,
          entityNodeId: node.id,
          alias: 'Orion',
          normalizedAlias: 'orion',
          entityType: 'PRODUCT',
          sourceType: 'TRANSCRIPT',
          sourceId: f.row.id,
          evidenceKey: randomUUID(),
        },
      });
    }
    const result = await publishOrganizationSection(f.input);
    expect(result.warnings).toContain('AMBIGUOUS_IDENTITY');
    expect(await db.brainEdge.count({ where: { userId: users[0]!, kind: 'PART_OF' } })).toBe(0);
    expect(await db.brainEntityAlias.count({ where: { userId: users[0]! } })).toBe(2);
  });

  test('does not merge distinct source names that share a punctuation-stripped slug', async () => {
    const f = await fixture(
      'C++ and C# have separate specifications and distinct language designs.',
      ['C++', 'C#'],
    );
    f.analysis.relationships = [];
    await publishOrganizationSection(f.input);
    const nodes = await db.brainNode.findMany({ where: { userId: users[0]!, type: 'ENTITY' } });
    expect(nodes.map((node) => node.label).sort()).toEqual(['C#', 'C++']);
    expect(new Set(nodes.map((node) => node.key)).size).toBe(2);
    await publishOrganizationSection(f.input);
    expect(await db.brainNode.count({ where: { userId: users[0]!, type: 'ENTITY' } })).toBe(2);
  });

  test('does not resolve C# through an existing C++ alias with the same normalized spelling', async () => {
    const f = await fixture('C# is part of the Vega project and documents its release process.', [
      'C#',
      'Vega',
    ]);
    const cpp = await db.brainNode.create({
      data: {
        userId: users[0]!,
        key: 'ENTITY:product:c',
        type: 'ENTITY',
        label: 'C++',
        metadata: { entityType: 'PRODUCT' },
      },
    });
    await db.brainEntityAlias.create({
      data: {
        userId: users[0]!,
        entityNodeId: cpp.id,
        alias: 'C++',
        normalizedAlias: 'c',
        entityType: 'PRODUCT',
        sourceType: 'TRANSCRIPT',
        sourceId: f.row.id,
        evidenceKey: randomUUID(),
      },
    });
    await publishOrganizationSection(f.input);
    const relation = await db.brainEdge.findFirstOrThrow({
      where: { userId: users[0]!, kind: 'PART_OF' },
    });
    expect(relation.fromNodeId).not.toBe(cpp.id);
    expect(
      await db.brainNode.findUniqueOrThrow({ where: { id: relation.fromNodeId } }),
    ).toMatchObject({ label: 'C#' });
  });

  test('keeps one symmetric relationship when another source reverses its endpoints', async () => {
    const f = await fixture();
    f.analysis.relationships[0]!.kind = 'RELATED_TO';
    await publishOrganizationSection(f.input);
    const g = await fixture();
    g.analysis.relationships[0] = {
      ...g.analysis.relationships[0]!,
      from: 'vega',
      to: 'orion',
      kind: 'RELATED_TO',
    };
    await publishOrganizationSection(g.input);
    const edges = await db.brainEdge.findMany({
      where: { userId: users[0]!, kind: 'RELATED_TO', method: 'llm-grounded-organization' },
      include: { sources: true },
    });
    expect(edges).toHaveLength(1);
    expect(new Set(edges[0]!.sources.map((source) => source.sourceId))).toEqual(
      new Set([f.row.id, g.row.id]),
    );
  });

  test('rolls back graph writes and the section receipt when the final execution guard fails', async () => {
    const f = await fixture();
    let checks = 0;
    await expect(
      publishOrganizationSection({
        ...f.input,
        assertCurrent: async () => {
          if (++checks > 1) throw new Error('LEASE_LOST');
        },
        commit: async (tx) => {
          await tx.brainCompilation.create({
            data: { userId: users[0]!, transcriptId: f.row.id, contentHash: 'receipt-test' },
          });
        },
      }),
    ).rejects.toThrow('LEASE_LOST');
    expect(await db.brainNode.count({ where: { userId: users[0]! } })).toBe(0);
    expect(await db.brainSource.count({ where: { userId: users[0]! } })).toBe(0);
    expect(await db.brainCompilation.count({ where: { userId: users[0]! } })).toBe(0);
  });

  test('rejects foreign owners, source changes, inactive documents and forged evidence before publication', async () => {
    const f = await fixture();
    await expect(
      publishOrganizationSection({ ...f.input, source: { ...f.source, userId: users[1]! } }),
    ).rejects.toThrow('NOT_FOUND');
    await db.transcript.update({ where: { id: f.row.id }, data: { title: 'Changed title' } });
    await expect(publishOrganizationSection(f.input)).rejects.toThrow('STALE_SOURCE');
    for (const change of [
      { sourceVersion: 3 },
      { correctionRevision: 2 },
      { correctedMarkdown: `${markdown}\nChanged correction.` },
    ]) {
      await db.transcript.update({
        where: { id: f.row.id },
        data: {
          title: f.row.title,
          sourceVersion: 2,
          correctionRevision: 1,
          correctedMarkdown: markdown,
          ...change,
        },
      });
      await expect(publishOrganizationSection(f.input)).rejects.toThrow('STALE_SOURCE');
    }
    await db.transcript.update({
      where: { id: f.row.id },
      data: {
        title: f.row.title,
        sourceVersion: 2,
        correctionRevision: 1,
        correctedMarkdown: markdown,
        status: 'ARCHIVED',
      },
    });
    await expect(publishOrganizationSection(f.input)).rejects.toThrow('NOT_FOUND');
    await db.transcript.update({ where: { id: f.row.id }, data: { status: 'ACTIVE' } });
    const analysis = structuredClone(f.analysis);
    analysis.nodes[0]!.evidence.excerpt = 'Invented source quotation';
    await expect(publishOrganizationSection({ ...f.input, analysis })).rejects.toThrow(
      'INVALID_EVIDENCE',
    );
    expect(await db.brainEdge.count({ where: { userId: { in: users } } })).toBe(0);
  });

  test('reports unavailable canonical storage separately from an obsolete source revision', async () => {
    const f = await fixture();
    await db.transcript.update({
      where: { id: f.row.id },
      data: { correctionState: 'STALE', correctedMarkdown: null },
    });
    const source = { ...f.source, correctionState: 'STALE' as const };
    const analysis = await f.analyze(source);
    await expect(publishOrganizationSection({ ...f.input, source, analysis })).rejects.toThrow(
      'UNAVAILABLE_SOURCE',
    );
    expect(await db.brainEdge.count({ where: { userId: users[0]! } })).toBe(0);
  });
});
