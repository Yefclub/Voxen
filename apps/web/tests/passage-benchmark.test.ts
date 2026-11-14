import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { cpus } from 'node:os';
import { Prisma } from '../prisma-generated/client';
import { db } from '../src/lib/db';
import { storagePut } from '../src/lib/storage';
import { createSourceEvidenceManifest } from '../src/lib/source-provenance';
import { searchKnowledgeBasePage } from '../src/lib/search';
import { searchBrainNodes } from '../src/lib/brain-search';
import { executePassageIndex } from '../src/lib/passage-index/runner';
import {
  PassageSearchSchema,
  passageSearchSql,
  searchPassages,
} from '../src/lib/passage-index/search';
import { readPassage } from '../src/lib/passage-index/read';
import type { PassageIdentity } from '../src/lib/passage-index/source';

type Case = { query: string; id: string; quote: string | null; entity?: boolean };
const suite = process.env.PASSAGE_BENCHMARK === '1' ? describe : describe.skip;
const quantile = (values: number[], fraction: number) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1] ?? 0;
const clean = (text: string) => text.replace(/[«»]/g, '').replace(/\s+/g, ' ').trim();

suite('isolated measured PostgreSQL passage evaluation', () => {
  test('compares the production queries, canonical citations, latency and persisted index cost', async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      !/^\/voxen_passage_benchmark(?:_\w+)?$/.test(url.pathname)
    )
      throw new Error('The benchmark requires a dedicated local voxen_passage_benchmark database.');
    const users: string[] = [],
      sources: PassageIdentity[] = [],
      cases: Case[] = [];
    const documents = new Map<string, { userId: string; text: string }>();
    const inaccessible = new Set<string>();
    try {
      for (let i = 0; i < 2; i++)
        users.push(
          (
            await db.user.create({
              data: {
                email: `passage-benchmark-${randomUUID()}@example.test`,
                name: 'Synthetic passage benchmark',
                status: 'APPROVED',
              },
            })
          ).id,
        );
      const owner = users[0]!,
        foreign = users[1]!;
      async function note(text: string, title: string, userId = owner) {
        const row = await db.note.create({ data: { userId, title, content: text } });
        documents.set(row.id, { userId, text });
        sources.push({ userId, type: 'note', id: row.id });
        return row;
      }
      async function transcript(text: string, title: string, userId = owner) {
        const id = randomUUID(),
          mdPath = `workspaces/${userId}/transcripts/${id}/benchmark.md`;
        await storagePut({ key: mdPath, body: text, contentType: 'text/markdown' });
        const row = await db.transcript.create({
          data: {
            id,
            userId,
            title,
            source: 'WEB',
            url: `https://example.test/benchmark/${id}`,
            durationSec: 0,
            language: 'en',
            transcriptionMethod: 'SCRAPE',
            mdPath,
            plainText: text,
            frontmatter: {},
            sourceVersion: 1,
            sourceChecksum: `synthetic-${id}`,
            sourceMetadata: {
              producer: 'voxen-capture',
              evidenceManifest: createSourceEvidenceManifest(text, [
                { start: 0, end: text.length },
              ]),
            },
          },
        });
        documents.set(id, { userId, text });
        sources.push({ userId, type: 'transcript', id });
        return row;
      }
      for (let i = 0; i < 450; i++) {
        const text =
          `# Synthetic background ${i}\n` +
          (i % 2
            ? 'Esta biblioteca reúne documentos, pesquisa, organização e referências de conteúdo. '
            : 'This library contains documents, indexing, research, organization and knowledge references. '
          ).repeat(20 + (i % 20));
        await note(text, `Synthetic reference ${i}`);
      }
      for (let i = 0; i < 8; i++) {
        const quote = `Researchers run workflows for clusterorion${i}.`;
        const row = await note(`# English experiments\n${quote}\n`, `Research workflow ${i}`);
        cases.push({ query: `running workflows clusterorion${i}`, id: row.id, quote });
        const ptQuote = `Organizações brasileiras mantêm a referência brasilorion${i}.`;
        const pt = await note(`# Pesquisa\n${ptQuote}\n`, `Pesquisa documental ${i}`);
        cases.push({ query: `organização brasileira brasilorion${i}`, id: pt.id, quote: ptQuote });
      }
      for (const identifier of [
        'C++',
        'C#',
        'AWS-MCP-739',
        'RFC_9457',
        'pkg.module/v2',
        'FLOW:8A.19',
      ]) {
        const quote = `The literal identifier ${identifier} belongs to this document.`;
        const row = await note(`# Identifier\n${quote}\n`, `Literal reference ${identifier}`);
        cases.push({ query: identifier, id: row.id, quote });
      }
      for (let i = 0; i < 4; i++) {
        const quote = `The middle passage retains MID-SOURCE-${i}-739 exactly.`;
        const text =
          '# Long source\n' +
          'A neutral opening observation.\n'.repeat(2600) +
          `[00:12:30] ${quote}\n` +
          'A neutral closing observation.\n'.repeat(2600);
        const row = await transcript(text, `Long source ${i}`);
        cases.push({ query: `MID-SOURCE-${i}-739`, id: row.id, quote });
        const parent = await transcript(
          'An unchanged canonical source.',
          `External research parent ${i}`,
        );
        const externalQuote = `Accepted evidence records EXTERNAL-REF-${i}-991 separately from the original.`;
        const enrichment = await db.transcriptEnrichment.create({
          data: {
            userId: owner,
            transcriptId: parent.id,
            runKey: randomUUID(),
            trigger: 'MANUAL',
            status: 'READY',
            reviewState: 'ACCEPTED',
            title: `External reference ${i}`,
            content: externalQuote,
            sourceVersion: 1,
            sourceChecksum: parent.sourceChecksum,
          },
        });
        documents.set(enrichment.id, { userId: owner, text: externalQuote });
        sources.push({ userId: owner, type: 'external_enrichment', id: enrichment.id });
        cases.push({ query: `EXTERNAL-REF-${i}-991`, id: enrichment.id, quote: externalQuote });
        const title = await note('A synthetic guide to extraction.', `Firecrawl atlasorion${i}`);
        cases.push({ query: `Firecrwal atlasorion${i}`, id: title.id, quote: null });
        const entity = await db.brainNode.create({
          data: {
            userId: owner,
            key: `ENTITY:benchmark:orion${i}`,
            label: `PostgreSQL entityorion${i}`,
            type: 'ENTITY',
            sourceType: 'MANUAL',
          },
        });
        cases.push({
          query: `Postgresq entityorion${i}`,
          id: entity.id,
          quote: null,
          entity: true,
        });
      }
      for (let i = 0; i < 60; i++) {
        const target = cases[i % cases.length]!;
        const row = await note(target.quote ?? target.query, target.query, foreign);
        inaccessible.add(row.id);
      }
      const archived = await transcript(cases[0]!.quote!, cases[0]!.query);
      inaccessible.add(archived.id);
      const indexStart = performance.now();
      for (let start = 0; start < sources.length; start += 4)
        expect(
          await Promise.all(sources.slice(start, start + 4).map((s) => executePassageIndex(s))),
        ).toEqual(Array.from({ length: Math.min(4, sources.length - start) }, () => true));
      const indexingMs = performance.now() - indexStart;
      await db.transcript.update({ where: { id: archived.id }, data: { status: 'ARCHIVED' } });
      for (const table of [
        'Note',
        'Transcript',
        'TranscriptEnrichment',
        'PassageIndexSource',
        'RetrievalPassage',
        'BrainNode',
      ])
        await db.$executeRawUnsafe(`ANALYZE "${table}"`);
      const baselineTimes: number[] = [],
        candidateTimes: number[] = [];
      const observations: Array<{
        query: string;
        source: string;
        entity: boolean;
        baselineFound: boolean;
        candidateFound: boolean;
        baselinePassage: boolean;
        candidatePassage: boolean;
      }> = [];
      let verifiedCitations = 0;
      for (let round = 0; round < 4; round++)
        for (const entry of cases) {
          const baselineRun = async () => {
            const start = performance.now();
            const result = entry.entity
              ? await searchBrainNodes(owner, entry.query, 8)
              : (await searchKnowledgeBasePage(owner, entry.query, 8)).results;
            if (round > 0) baselineTimes.push(performance.now() - start);
            for (const hit of result) {
              expect(inaccessible.has(hit.id)).toBe(false);
              if (!entry.entity) expect(documents.get(hit.id)?.userId).toBe(owner);
            }
            return result;
          };
          const candidateRun = async () => {
            const start = performance.now();
            const result = await searchPassages(owner, { query: entry.query });
            if (round > 0) candidateTimes.push(performance.now() - start);
            expect(result.limitations).toEqual([]);
            for (const hit of result.results) {
              expect(inaccessible.has(hit.sourceId)).toBe(false);
              expect(documents.get(hit.sourceId)?.userId).toBe(owner);
              if (round === 0) {
                const read = await readPassage(owner, hit.key, hit.revision);
                expect(
                  documents.get(hit.sourceId)!.text.slice(hit.startOffset, hit.endOffset),
                ).toBe(read.text);
                expect(read.text).toContain(hit.excerpt);
                verifiedCitations++;
              }
            }
            for (const lead of result.discovery) expect(inaccessible.has(lead.id)).toBe(false);
            return result;
          };
          // Alternate query order; the first round warms both paths and is excluded.
          const [baseline, candidate] =
            round % 2
              ? await (async () => {
                  const c = await candidateRun();
                  return [await baselineRun(), c] as const;
                })()
              : ([await baselineRun(), await candidateRun()] as const);
          if (round === 0)
            observations.push({
              query: entry.query,
              source: entry.id,
              entity: !!entry.entity,
              baselineFound: baseline.some((hit) => hit.id === entry.id),
              candidateFound:
                candidate.results.some((hit) => hit.sourceId === entry.id) ||
                candidate.discovery.some((hit) => hit.id === entry.id),
              baselinePassage:
                !!entry.quote &&
                baseline.some(
                  (hit) =>
                    hit.id === entry.id &&
                    'snippet' in hit &&
                    clean(hit.snippet).includes(clean(entry.quote!)),
                ),
              candidatePassage:
                !!entry.quote &&
                candidate.results.some(
                  (hit) =>
                    hit.sourceId === entry.id && clean(hit.excerpt).includes(clean(entry.quote!)),
                ),
            });
        }
      const factual = observations.filter(
        (o) => cases.find((c) => c.id === o.source)!.quote !== null,
      );
      const docs = observations.filter((o) => !o.entity),
        entities = observations.filter((o) => o.entity);
      const recall = (
        entries: typeof observations,
        field: 'baselineFound' | 'candidateFound' | 'baselinePassage' | 'candidatePassage',
      ) => entries.filter((entry) => entry[field]).length / entries.length;
      const sizes = await db.$queryRaw<Array<{ name: string; bytes: bigint; totalBytes: bigint }>>`
        SELECT c.relname AS name, pg_relation_size(c.oid) AS bytes, pg_total_relation_size(c.oid) AS "totalBytes"
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname IN ('RetrievalPassage', 'RetrievalPassage_searchVector_idx',
          'PassageIndexSource', 'PassageIndexSource_title_trgm_idx', 'PassageIndexSource_searchVector_idx',
          'BrainNode_label_trgm_idx', 'Note_searchVector_idx', 'Transcript_searchVector_idx')
        ORDER BY c.relname
      `;
      const first = cases.find((c) => c.query.startsWith('MID-SOURCE'))!;
      const plan = await db.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        ${passageSearchSql(owner, PassageSearchSchema.parse({ query: first.query }))}`);
      const report = {
        synthetic: true,
        recordedAt: new Date().toISOString(),
        host: { cpu: cpus()[0]?.model, cores: cpus().length, bun: process.versions.bun },
        postgres: await db.$queryRaw`SELECT version()`,
        corpus: {
          ownedSources: sources.filter((s) => s.userId === owner).length,
          foreignSources: sources.filter((s) => s.userId === foreign).length,
          sourceBytes: [...documents.values()].reduce(
            (sum, value) => sum + Buffer.byteLength(value.text),
            0,
          ),
          passages: await db.retrievalPassage.count(),
          indexingMs,
          cases: cases.length,
        },
        baseline: {
          strategy: 'existing Portuguese FTS; existing graph search for entity cases',
          sourceRecall: recall(docs, 'baselineFound'),
          passageRecall: recall(factual, 'baselinePassage'),
          entityDiscoveryRecall: recall(entities, 'baselineFound'),
          p50Ms: quantile(baselineTimes, 0.5),
          p95Ms: quantile(baselineTimes, 0.95),
          citationValidity:
            'Source-level leads; no versioned passage citation is supplied by the baseline.',
        },
        candidate: {
          strategy: 'versioned multilingual lexical passages; bounded typo name leads',
          sourceRecall: recall(docs, 'candidateFound'),
          passageRecall: recall(factual, 'candidatePassage'),
          entityDiscoveryRecall: recall(entities, 'candidateFound'),
          p50Ms: quantile(candidateTimes, 0.5),
          p95Ms: quantile(candidateTimes, 0.95),
          verifiedCitations,
          citationValidity: 1,
        },
        relations: sizes.map((row) => ({
          name: row.name,
          bytes: Number(row.bytes),
          totalBytes: Number(row.totalBytes),
        })),
        observations,
        representativeCandidatePlan: plan,
        measurement:
          'One excluded warm-up round and three alternating-order measured rounds. Actual production query functions; canonical citation checks are outside timed search. Passage recall means the complete fixture quotation occurs in the returned excerpt; this is stricter than headline relevance. Baseline snippets retain their existing short word limit; candidate excerpts are bounded to 1200 UTF-16 units. Name leads count toward source/name discovery only, never passage recall.',
      };
      if (process.env.PASSAGE_BENCHMARK_REPORT)
        await Bun.write(process.env.PASSAGE_BENCHMARK_REPORT, JSON.stringify(report, null, 2));
      expect(report.corpus.ownedSources).toBeGreaterThanOrEqual(400);
      expect(report.candidate.sourceRecall).toBeGreaterThanOrEqual(report.baseline.sourceRecall);
      expect(report.candidate.passageRecall).toBeGreaterThanOrEqual(report.baseline.passageRecall);
      expect(report.candidate.entityDiscoveryRecall).toBeGreaterThanOrEqual(
        report.baseline.entityDiscoveryRecall,
      );
      expect(report.candidate.verifiedCitations).toBeGreaterThan(0);
      expect(report.candidate.p95Ms).toBeLessThanOrEqual(250);
    } finally {
      await db.user.deleteMany({ where: { id: { in: users } } });
    }
  }, 120_000);
});
