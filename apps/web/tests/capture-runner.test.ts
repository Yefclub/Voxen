import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AiRole, CaptureDeps } from '../src/lib/capture/runner';
import type { WorkerExtraction, WorkerFileResult } from '../src/lib/capture/worker-client';

const storageRoot = mkdtempSync(join(tmpdir(), 'voxen-capture-runner-'));
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_PATH = storageRoot;

const { db } = await import('../src/lib/db');
const runner = await import('../src/lib/capture/runner');
const { CaptureError } = await import('../src/lib/capture/errors');

const DB_AVAILABLE = !!process.env.DATABASE_URL;
const describeIfDb = DB_AVAILABLE ? describe : describe.skip;

const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function extraction(over: Partial<WorkerExtraction> = {}): WorkerExtraction {
  return {
    platform: 'web',
    canonicalUrl: 'https://example.com/a',
    platformId: null,
    title: 'Título da página',
    author: null,
    channel: 'Example',
    publishedAt: null,
    durationSec: null,
    language: 'pt',
    description: null,
    text: 'Conteúdo longo sobre filas duráveis no Postgres. '.repeat(20),
    textKind: 'page',
    segments: [],
    hasAudio: false,
    images: [],
    extractor: 'trafilatura',
    ...over,
  };
}

type Calls = {
  extract: number;
  audio: number;
  file: number;
  stt: number;
  generate: Array<AiRole>;
};

function makeDeps(opts: {
  extract?: () => Promise<WorkerExtraction>;
  file?: () => Promise<WorkerFileResult>;
  audioDurationSec?: number;
  roles?: AiRole[];
  calls: Calls;
}): CaptureDeps {
  const roles = new Set<AiRole>(opts.roles ?? ['fast', 'standard', 'vision', 'stt']);
  return {
    worker: {
      extract: async () => {
        opts.calls.extract += 1;
        return (opts.extract ?? (async () => extraction()))();
      },
      audio: async () => {
        opts.calls.audio += 1;
        return {
          durationSec: opts.audioDurationSec ?? 40,
          chunks: [{ startSec: 0, mime: 'audio/mpeg', dataBase64: 'AAAA' }],
        };
      },
      file: async () => {
        opts.calls.file += 1;
        if (!opts.file) throw new Error('not used');
        return opts.file();
      },
    },
    ai: {
      isRoleConfigured: async (_userId, role) =>
        roles.has(role) || (role === 'standard' && roles.has('fast')),
      chainLength: async (_userId, role) =>
        roles.has(role) || (role === 'standard' && roles.has('fast')) ? 1 : 0,
      generateStructured: async <T>(input: { role: AiRole }) => {
        opts.calls.generate.push(input.role);
        if (input.role === 'vision') {
          return {
            output: { descriptions: [{ index: 1, description: 'Um gráfico de barras.' }] } as T,
            modelRef: 'anthropic:claude-haiku-5-5',
            costUsd: 0.0001,
          };
        }
        return {
          output: {
            title: 'Filas duráveis no Postgres',
            language: 'pt',
            summary_md: 'Explica filas com SKIP LOCKED. Veja https://evil.example.',
            key_points: ['Usa SKIP LOCKED'],
            tags: ['Postgres', '#filas', 'postgres'],
            entities: [{ name: 'PostgreSQL', kind: 'software' }],
          } as T,
          modelRef: 'anthropic:claude-haiku-5-5',
          costUsd: 0.0003,
        };
      },
      transcribeAudio: async () => {
        opts.calls.stt += 1;
        return {
          text: 'Fala transcrita sobre bancos de dados. '.repeat(10),
          segments: [{ startSec: 0, endSec: 5, text: 'Fala transcrita sobre bancos de dados.' }],
          language: 'pt',
          model: 'openai:gpt-transcribe',
          costUsd: 0.003,
        };
      },
    },
  };
}

function freshCalls(): Calls {
  return { extract: 0, audio: 0, file: 0, stt: 0, generate: [] };
}

describeIfDb('capture runner', () => {
  let userId = '';

  beforeAll(async () => {
    const user = await db.user.create({
      data: {
        email: `capture-runner-${Date.now()}@voxen.local`,
        name: 'Runner',
        status: 'APPROVED',
      },
    });
    userId = user.id;
  });

  beforeEach(async () => {
    await db.job.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    await db.$disconnect();
    rmSync(storageRoot, { recursive: true, force: true });
  });

  async function queue(url: string, type: 'CAPTURE_LINK' | 'CAPTURE_UPLOAD' = 'CAPTURE_LINK') {
    return db.job.create({ data: { userId, type, status: 'QUEUED', sourceUrl: url } });
  }

  async function claimAndRun(jobId: string, deps: CaptureDeps) {
    const job = await runner.claimCaptureJob(jobId, 'test-owner');
    expect(job).not.toBeNull();
    await runner.runCaptureJob(job!, deps);
    return db.job.findUniqueOrThrow({ where: { id: jobId } });
  }

  it('captures a web page into a published document with clean tags', async () => {
    const calls = freshCalls();
    const job = await queue(`https://example.com/a-${Date.now()}`);
    const done = await claimAndRun(job.id, makeDeps({ calls }));
    expect(done.status).toBe('DONE');
    expect(done.transcriptId).toBeTruthy();
    expect(Number(done.captureCostUsd)).toBeCloseTo(0.0003, 6);
    expect(calls.stt).toBe(0);
    expect(calls.generate).toEqual(['standard']);
    const doc = await db.transcript.findUniqueOrThrow({
      where: { id: done.transcriptId! },
      include: { tags: { include: { tag: true } } },
    });
    expect(doc.transcriptionMethod).toBe('SCRAPE');
    expect(doc.summaryMd).not.toContain('evil.example');
    expect(doc.tags.map((t) => t.tag.slug).sort()).toEqual(['filas', 'postgres']);
  });

  it('ends with STT_NOT_CONFIGURED when only audio exists and no STT role is set', async () => {
    const calls = freshCalls();
    const job = await queue(`https://vt.tiktok.com/Z${Date.now()}`);
    const deps = makeDeps({
      calls,
      roles: ['standard'],
      extract: async () =>
        extraction({ platform: 'tiktok', text: null, textKind: 'none', hasAudio: true }),
    });
    const failed = await claimAndRun(job.id, deps);
    expect(failed.status).toBe('FAILED');
    expect(failed.captureErrorCode).toBe('STT_NOT_CONFIGURED');
    expect(failed.errorMsg).toContain('STT não configurado');
    expect(calls.audio).toBe(0);
  });

  it('uses a long video description as text and never calls STT (text first)', async () => {
    const calls = freshCalls();
    const job = await queue(`https://youtu.be/d${Date.now()}`.slice(0, 40));
    const deps = makeDeps({
      calls,
      roles: ['standard'],
      extract: async () =>
        extraction({
          platform: 'youtube',
          text: 'Descrição longa do vídeo sobre arquitetura de software. '.repeat(10),
          textKind: 'description',
          hasAudio: true,
        }),
    });
    const done = await claimAndRun(job.id, deps);
    expect(done.status).toBe('DONE');
    expect(calls.audio).toBe(0);
    expect(calls.stt).toBe(0);
  });

  it('transcribes audio-only content when STT is configured', async () => {
    const calls = freshCalls();
    const job = await queue(`https://vt.tiktok.com/Y${Date.now()}`);
    const deps = makeDeps({
      calls,
      extract: async () =>
        extraction({ platform: 'tiktok', text: null, textKind: 'none', hasAudio: true }),
    });
    const done = await claimAndRun(job.id, deps);
    expect(done.status).toBe('DONE');
    expect(calls.stt).toBe(1);
    const doc = await db.transcript.findUniqueOrThrow({ where: { id: done.transcriptId! } });
    expect(doc.transcriptionMethod).toBe('API');
    expect(doc.source).toBe('TIKTOK');
  });

  it('describes images when text is short and a vision role exists', async () => {
    const calls = freshCalls();
    const job = await queue(`https://x.com/i/status/${Date.now()}`);
    const deps = makeDeps({
      calls,
      extract: async () =>
        extraction({
          platform: 'x',
          text: 'Olha esse gráfico.',
          textKind: 'post',
          images: [{ kind: 'post_media', mime: 'image/png', dataBase64: PNG_1PX }],
        }),
    });
    const done = await claimAndRun(job.id, deps);
    expect(done.status).toBe('DONE');
    expect(calls.generate).toEqual(['vision', 'standard']);
    const doc = await db.transcript.findUniqueOrThrow({ where: { id: done.transcriptId! } });
    expect(doc.plainText).toContain('gráfico de barras');
    expect(doc.previewObjectKey).toContain('/thumbnail.png');
  });

  it('fails at run time with AI_NOT_CONFIGURED when the text role disappeared', async () => {
    const calls = freshCalls();
    const job = await queue(`https://example.com/no-ai-${Date.now()}`);
    const failed = await claimAndRun(job.id, makeDeps({ calls, roles: [] }));
    expect(failed.captureErrorCode).toBe('AI_NOT_CONFIGURED');
    expect(failed.status).toBe('FAILED');
    expect(calls.extract).toBe(0);
  });

  it('requeues retryable errors with backoff and reuses the stored artifact', async () => {
    const calls = freshCalls();
    const job = await queue(`https://example.com/retry-${Date.now()}`);
    let failNext = true;
    const deps = makeDeps({ calls });
    const flaky = {
      ...deps,
      ai: {
        ...deps.ai,
        generateStructured: async <T>(
          input: Parameters<CaptureDeps['ai']['generateStructured']>[0],
        ) => {
          if (failNext) {
            failNext = false;
            throw new CaptureError('TIMEOUT');
          }
          return deps.ai.generateStructured<T>(input as never);
        },
      },
    } as CaptureDeps;
    const requeued = await claimAndRun(job.id, flaky);
    expect(requeued.status).toBe('QUEUED');
    expect(requeued.captureErrorCode).toBe('TIMEOUT');
    expect(requeued.notBefore!.getTime()).toBeGreaterThan(Date.now());
    expect(await runner.claimCaptureJob(job.id, 'too-early')).toBeNull();

    const later = new Date(Date.now() + 60 * 60_000);
    const reclaimed = await runner.claimCaptureJob(job.id, 'test-owner', later);
    expect(reclaimed).not.toBeNull();
    await runner.runCaptureJob(reclaimed!, flaky);
    const done = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.status).toBe('DONE');
    expect(calls.extract).toBe(1);
  });

  it('reclaims an expired lease after a crash and completes the job', async () => {
    const calls = freshCalls();
    const job = await queue(`https://example.com/crash-${Date.now()}`);
    const claimed = await runner.claimCaptureJob(job.id, 'dead-process');
    expect(claimed).not.toBeNull();
    // Simulate the process dying: the lease is never renewed.
    await db.job.update({
      where: { id: job.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
    });
    const ids = await runner.listRunnableCaptureJobs();
    expect(ids).toContain(job.id);
    const done = await claimAndRun(job.id, makeDeps({ calls }));
    expect(done.status).toBe('DONE');
    expect(done.attempt).toBe(2);
  });

  it('stops without publishing when the job is cancelled mid-run', async () => {
    const calls = freshCalls();
    const job = await queue(`https://example.com/cancel-${Date.now()}`);
    const deps = makeDeps({
      calls,
      extract: async () => {
        await db.job.update({ where: { id: job.id }, data: { status: 'CANCELLED' } });
        return extraction();
      },
    });
    const after = await claimAndRun(job.id, deps);
    expect(after.status).toBe('CANCELLED');
    expect(after.transcriptId).toBeNull();
    expect(calls.generate).toEqual([]);
  });

  it('fails with NO_TEXT when there is no text, audio or image', async () => {
    const calls = freshCalls();
    const job = await queue(`https://example.com/empty-${Date.now()}`);
    const failed = await claimAndRun(
      job.id,
      makeDeps({ calls, extract: async () => extraction({ text: null, textKind: 'none' }) }),
    );
    expect(failed).toMatchObject({ status: 'FAILED', captureErrorCode: 'NO_TEXT' });
  });

  it('turns a worker BLOCKED_ADDRESS error into a permanent job failure', async () => {
    const calls = freshCalls();
    const job = await queue(`https://redirects-to-metadata.example/${Date.now()}`);
    const failed = await claimAndRun(
      job.id,
      makeDeps({
        calls,
        extract: async () => {
          throw new CaptureError('BLOCKED_ADDRESS');
        },
      }),
    );
    expect(failed).toMatchObject({ status: 'FAILED', captureErrorCode: 'BLOCKED_ADDRESS' });
    expect(failed.notBefore).toBeNull();
  });

  it('ends WORKER_UNAVAILABLE after the last attempt', async () => {
    const calls = freshCalls();
    const job = await queue(`https://example.com/worker-down-${Date.now()}`);
    await db.job.update({
      where: { id: job.id },
      data: { attempt: runner.CAPTURE_MAX_ATTEMPTS - 1 },
    });
    const failed = await claimAndRun(
      job.id,
      makeDeps({
        calls,
        extract: async () => {
          throw new CaptureError('WORKER_UNAVAILABLE');
        },
      }),
    );
    expect(failed).toMatchObject({ status: 'FAILED', captureErrorCode: 'WORKER_UNAVAILABLE' });
  });

  it('fails a step TIMEOUT on the last attempt', async () => {
    const calls = freshCalls();
    const job = await queue(`https://example.com/slow-${Date.now()}`);
    await db.job.update({
      where: { id: job.id },
      data: { attempt: runner.CAPTURE_MAX_ATTEMPTS - 1 },
    });
    const failed = await claimAndRun(
      job.id,
      makeDeps({
        calls,
        extract: async () => {
          throw new DOMException('timed out', 'TimeoutError');
        },
      }),
    );
    expect(failed).toMatchObject({ status: 'FAILED', captureErrorCode: 'TIMEOUT' });
  });

  it('fails TOO_LARGE for audio longer than three hours', async () => {
    const calls = freshCalls();
    const job = await queue(`https://vt.tiktok.com/L${Date.now()}`);
    const failed = await claimAndRun(
      job.id,
      makeDeps({
        calls,
        audioDurationSec: 3 * 3600 + 1,
        extract: async () =>
          extraction({ platform: 'tiktok', text: null, textKind: 'none', hasAudio: true }),
      }),
    );
    expect(failed).toMatchObject({ status: 'FAILED', captureErrorCode: 'TOO_LARGE' });
    expect(calls.stt).toBe(0);
  });

  it('keeps the artifact after LLM_QUOTA so a retry skips extraction', async () => {
    const calls = freshCalls();
    const job = await queue(`https://example.com/quota-${Date.now()}`);
    const base = makeDeps({ calls });
    let quota = true;
    const deps = {
      ...base,
      ai: {
        ...base.ai,
        generateStructured: async <T>(
          input: Parameters<CaptureDeps['ai']['generateStructured']>[0],
        ) => {
          if (quota)
            throw Object.assign(new Error('quota'), { code: 'LLM_QUOTA', retryable: false });
          return base.ai.generateStructured<T>(input as never);
        },
      },
    } as CaptureDeps;
    const failed = await claimAndRun(job.id, deps);
    expect(failed).toMatchObject({ status: 'FAILED', captureErrorCode: 'LLM_QUOTA' });
    quota = false;
    await db.job.update({ where: { id: job.id }, data: { status: 'QUEUED', attempt: 0 } });
    const done = await claimAndRun(job.id, deps);
    expect(done.status).toBe('DONE');
    expect(calls.extract).toBe(1);
  });

  it('requeues a retryable provider error instead of failing it', async () => {
    const calls = freshCalls();
    const job = await queue(`https://example.com/rate-${Date.now()}`);
    const base = makeDeps({ calls });
    const deps = {
      ...base,
      ai: {
        ...base.ai,
        generateStructured: async () => {
          throw Object.assign(new Error('429'), { code: 'LLM_FAILED', retryable: true });
        },
      },
    } as CaptureDeps;
    const requeued = await claimAndRun(job.id, deps);
    expect(requeued).toMatchObject({ status: 'QUEUED', captureErrorCode: 'LLM_FAILED' });
  });

  it('retries an audio upload after STT is configured by re-running the stored file', async () => {
    const calls = freshCalls();
    const objectKey = `workspaces/${userId}/uploads/u-${Date.now()}/voz.mp3`;
    const { storagePut } = await import('../src/lib/storage');
    await storagePut({
      key: objectKey,
      body: new Uint8Array([1, 2, 3]),
      contentType: 'audio/mpeg',
    });
    const job = await db.job.create({
      data: {
        userId,
        type: 'CAPTURE_UPLOAD',
        status: 'QUEUED',
        sourceUrl: `upload://00000000-0000-4000-8000-${String(Date.now()).slice(-12)}/voz.mp3`,
        captureMeta: {
          platform: 'upload',
          upload: { objectKey, filename: 'voz.mp3', mimeType: 'audio/mpeg' },
        },
      },
    });
    const fileResult = (): Promise<WorkerFileResult> =>
      Promise.resolve({
        ...extraction({
          platform: 'upload',
          text: null,
          textKind: 'none',
          hasAudio: true,
          canonicalUrl: null,
        }),
        audio: {
          durationSec: 30,
          chunks: [{ startSec: 0, mime: 'audio/mpeg', dataBase64: 'AAAA' }],
        },
      });
    const noStt = await claimAndRun(
      job.id,
      makeDeps({ calls, roles: ['standard'], file: fileResult }),
    );
    expect(noStt).toMatchObject({ status: 'FAILED', captureErrorCode: 'STT_NOT_CONFIGURED' });
    await db.job.update({ where: { id: job.id }, data: { status: 'QUEUED', attempt: 0 } });
    const done = await claimAndRun(job.id, makeDeps({ calls, file: fileResult }));
    expect(done.status).toBe('DONE');
    expect(calls.file).toBe(2);
    expect(calls.audio).toBe(0);
    expect(calls.stt).toBe(1);
    const doc = await db.transcript.findUniqueOrThrow({ where: { id: done.transcriptId! } });
    expect(doc).toMatchObject({
      source: 'UPLOAD',
      transcriptionMethod: 'API',
      originalObjectKey: objectKey,
    });
  });

  it('removes the capture artifact once the document is published', async () => {
    const calls = freshCalls();
    const job = await queue(`https://example.com/cleanup-${Date.now()}`);
    const done = await claimAndRun(job.id, makeDeps({ calls }));
    expect(done.status).toBe('DONE');
    const { storageHead } = await import('../src/lib/storage');
    await expect(storageHead(runner.captureArtifactKey(userId, job.id))).rejects.toBeDefined();
  });

  it('purges artifacts of week-old failed captures', async () => {
    const job = await queue(`https://example.com/stale-${Date.now()}`);
    const { storagePut, storageHead } = await import('../src/lib/storage');
    const key = runner.captureArtifactKey(userId, job.id);
    await storagePut({ key, body: '{}', contentType: 'application/json' });
    await db.job.update({
      where: { id: job.id },
      data: { status: 'FAILED', finishedAt: new Date(Date.now() - 8 * 24 * 3600_000) },
    });
    expect(await runner.purgeStaleCaptureArtifacts()).toBeGreaterThanOrEqual(1);
    await expect(storageHead(key)).rejects.toBeDefined();
  });

  it('fails over-budget expired leases instead of running them again', async () => {
    const job = await queue(`https://example.com/budget-${Date.now()}`);
    await db.job.update({
      where: { id: job.id },
      data: {
        status: 'RUNNING',
        attempt: runner.CAPTURE_MAX_ATTEMPTS,
        leaseExpiresAt: new Date(Date.now() - 1_000),
      },
    });
    expect(await runner.claimCaptureJob(job.id, 'x')).toBeNull();
    const failed = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(failed.status).toBe('FAILED');
  });
});

describe('capture backoff', () => {
  it('grows exponentially and caps at ten minutes', () => {
    expect(runner.captureBackoffMs(1)).toBe(30_000);
    expect(runner.captureBackoffMs(2)).toBe(60_000);
    expect(runner.captureBackoffMs(10)).toBe(600_000);
  });
});
