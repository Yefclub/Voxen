import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiError } from '../src/lib/ai/errors';
import { extraction, freshCalls, makeDeps } from './fixtures/capture-fakes';
import type { CaptureDeps } from '../src/lib/capture/runner';

const storageRoot = mkdtempSync(join(tmpdir(), 'voxen-long-source-'));
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_PATH = storageRoot;
const { db } = await import('../src/lib/db');
const { claimCaptureJob, runCaptureJob } = await import('../src/lib/capture/runner');
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const fact = 'O consenso do projeto Orion exige exatamente 42 revisores.';
const source = Array.from(
  { length: 1200 },
  (_, index) =>
    `Passagem ${index}: ${index === 600 ? fact : 'Leitura e documentação de fontes. '.repeat(4)}`,
).join('\n');

suite('complete long-source capture analysis', () => {
  let userId = '';
  beforeAll(async () => {
    userId = (
      await db.user.create({
        data: {
          email: `long-source-${randomUUID()}@example.test`,
          name: 'Long source',
          status: 'APPROVED',
        },
      })
    ).id;
  });
  beforeEach(async () => {
    await db.job.deleteMany({ where: { userId } });
  });
  afterAll(async () => {
    if (userId) await db.user.delete({ where: { id: userId } });
    rmSync(storageRoot, { recursive: true, force: true });
  });
  async function queue() {
    return db.job.create({
      data: {
        userId,
        type: 'CAPTURE_LINK',
        status: 'QUEUED',
        sourceUrl: `https://example.com/${randomUUID()}`,
      },
    });
  }
  async function run(id: string, deps: CaptureDeps) {
    const claimed = await claimCaptureJob(id, 'long-source-worker');
    expect(claimed).not.toBeNull();
    await runCaptureJob(claimed!, deps);
    return db.job.findUniqueOrThrow({ where: { id } });
  }
  function dependencies(text = source) {
    const calls = freshCalls();
    const deps = makeDeps({ calls, extract: async () => extraction({ text }) });
    const generate = deps.ai.generateStructured;
    deps.ai.generateStructured = async <T>(input: Parameters<typeof generate>[0]) => {
      const result = await generate(input);
      return {
        ...result,
        output: {
          title: 'Análise de leitura',
          language: 'pt',
          summary_md: input.untrusted.some((part) => 'text' in part && part.text.includes(fact))
            ? fact
            : 'Seção sobre leitura.',
          key_points: [],
          tags: [],
          entities: [],
        } as T,
      };
    };
    return { deps, calls };
  }

  it('includes the middle in synthesis and retains the complete canonical source', async () => {
    const { deps, calls } = dependencies();
    const done = await run((await queue()).id, deps);
    expect(done.status).toBe('DONE');
    const doc = await db.transcript.findUniqueOrThrow({ where: { id: done.transcriptId! } });
    expect(doc.summaryMd).toContain(fact);
    expect(doc.plainText).toContain(fact);
    for (const index of [0, 250, 500, 750, 1000, 1199]) {
      expect(calls.prompts.some((prompt) => prompt.includes(`Passagem ${index}:`))).toBe(true);
      expect(doc.plainText).toContain(`Passagem ${index}:`);
    }
    expect(calls.generate.length).toBeGreaterThan(1);
    expect(Number(done.captureCostUsd)).toBeCloseTo(calls.generate.length * 0.0003, 6);
  });

  it('reduces many sections through bounded synthesis without losing later evidence', async () => {
    const { deps, calls } = dependencies(source.repeat(4));
    const done = await run((await queue()).id, deps);
    expect(done.status).toBe('DONE');
    const doc = await db.transcript.findUniqueOrThrow({ where: { id: done.transcriptId! } });
    expect(doc.summaryMd).toContain(fact);
    expect(calls.generate.length).toBeGreaterThan(10);
    expect(calls.generate.length).toBeLessThanOrEqual(48);
    for (const prompt of calls.prompts) expect(prompt.length).toBeLessThan(60_000);
    expect(Number(done.captureCostUsd)).toBeCloseTo(calls.generate.length * 0.0003, 6);
  });

  it('keeps Unicode pairs intact across section boundaries', async () => {
    const { deps, calls } = dependencies(`x${'🙂'.repeat(60_000)}\n${fact}`);
    const done = await run((await queue()).id, deps);
    expect(done.status).toBe('DONE');
    for (const prompt of calls.prompts) expect(prompt).not.toMatch(/[\uD800-\uDFFF]/u);
    expect(calls.prompts.some((prompt) => prompt.includes(fact))).toBe(true);
  });

  it('rejects oversized analysis before paying for a model call', async () => {
    const { deps, calls } = dependencies('Texto. '.repeat(180_000));
    const failed = await run((await queue()).id, deps);
    expect(failed).toMatchObject({ status: 'FAILED', captureErrorCode: 'TEXT_TOO_LARGE' });
    expect(calls.generate).toEqual([]);
    expect(failed.transcriptId).toBeNull();
  });

  it('carries completed section and failed-call costs into a retry', async () => {
    const first = dependencies();
    const generate = first.deps.ai.generateStructured;
    let calls = 0;
    first.deps.ai.generateStructured = async (input) => {
      if (++calls === 2) {
        const error = new AiError('LLM_FAILED', 'Transient fixture failure', { retryable: true });
        error.costUsd = 0.0007;
        throw error;
      }
      return generate(input);
    };
    const job = await queue();
    const retry = await run(job.id, first.deps);
    expect(retry.status).toBe('QUEUED');
    expect(retry.captureMeta).toMatchObject({ failedCostUsd: 0.001 });
    await db.job.update({ where: { id: job.id }, data: { notBefore: new Date(0) } });
    const second = dependencies();
    const done = await run(job.id, second.deps);
    expect(done.status).toBe('DONE');
    expect(Number(done.captureCostUsd)).toBeCloseTo(
      0.001 + second.calls.generate.length * 0.0003,
      6,
    );
  });

  it.each(['cancelled', 'reclaimed'])(
    'stops after a section completes for a %s job',
    async (reason) => {
      const { deps, calls } = dependencies();
      const job = await queue();
      const generate = deps.ai.generateStructured;
      deps.ai.generateStructured = async (input) => {
        const result = await generate(input);
        await db.job.update({
          where: { id: job.id },
          data:
            reason === 'cancelled'
              ? { status: 'CANCELLED', workerId: null }
              : { workerId: 'new-owner' },
        });
        return result;
      };
      const stopped = await run(job.id, deps);
      expect(stopped.status).toBe(reason === 'cancelled' ? 'CANCELLED' : 'RUNNING');
      expect(stopped.workerId).toBe(reason === 'cancelled' ? null : 'new-owner');
      expect(stopped.transcriptId).toBeNull();
      expect(calls.generate).toHaveLength(1);
    },
  );
});
