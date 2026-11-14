import { afterAll, beforeAll, describe, expect, it, spyOn } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const storageRoot = mkdtempSync(join(tmpdir(), 'voxen-capture-publish-'));
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_PATH = storageRoot;

const { db } = await import('../src/lib/db');
const { storageReadText } = await import('../src/lib/storage');
const { captureTranscriptId, publishCapturedDocument } = await import('../src/lib/capture/publish');
type PublishInput = Parameters<typeof publishCapturedDocument>[0];

const DB_AVAILABLE = !!process.env.DATABASE_URL;
const describeIfDb = DB_AVAILABLE ? describe : describe.skip;

function baseInput(userId: string, jobId: string, text: string): PublishInput {
  return {
    jobId,
    userId,
    refreshTranscriptId: null,
    sourceUrl: 'https://example.com/post',
    method: 'SCRAPE',
    model: 'anthropic:claude-haiku-5-5',
    costUsd: 0.0004,
    artifact: {
      version: 1,
      platform: 'web',
      submittedUrl: 'https://example.com/post?utm_source=x',
      canonicalUrl: 'https://example.com/post',
      platformId: null,
      title: 'Página original',
      author: 'Autora',
      channel: 'Example',
      publishedAt: '2026-11-01T10:00:00Z',
      durationSec: null,
      language: 'pt',
      description: null,
      text,
      textKind: 'page',
      segments: [],
      hasAudio: false,
      images: [],
      extractor: 'trafilatura',
    },
    interpretation: {
      title: 'Como funciona a busca full-text no Postgres',
      language: 'pt',
      summaryMd: 'Resumo com [link](https://evil.example) e ![img](https://track.example/p.gif).',
      keyPoints: ['Ponto um', 'Veja https://evil.example/x'],
      tags: ['postgres', 'busca'],
      entities: [{ name: 'PostgreSQL', kind: 'software' }],
    },
  };
}

describeIfDb('capture publication (contract v2 DOCUMENT)', () => {
  let userId = '';
  let jobId = '';

  beforeAll(async () => {
    const user = await db.user.create({
      data: {
        email: `capture-publish-${Date.now()}@voxen.local`,
        name: 'Capture',
        status: 'APPROVED',
      },
    });
    userId = user.id;
    const job = await db.job.create({
      data: {
        userId,
        type: 'CAPTURE_LINK',
        status: 'RUNNING',
        sourceUrl: 'https://example.com/post',
      },
    });
    jobId = job.id;
  });

  afterAll(async () => {
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    await db.$disconnect();
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it('creates one searchable document and replays idempotently', async () => {
    const text = 'O Postgres usa tsvector e índices GIN para busca textual rápida em português.';
    const first = await publishCapturedDocument(baseInput(userId, jobId, text));
    expect(first.created).toBe(true);
    expect(first.transcriptId).toBe(captureTranscriptId(jobId));

    const replay = await publishCapturedDocument(baseInput(userId, jobId, text));
    expect(replay).toEqual({ transcriptId: first.transcriptId, created: false, changed: false });
    expect(await db.transcript.count({ where: { userId } })).toBe(1);

    const doc = await db.transcript.findUniqueOrThrow({
      where: { id: first.transcriptId },
      include: { tags: { include: { tag: true } } },
    });
    expect(doc.title).toBe('Como funciona a busca full-text no Postgres');
    expect(doc.summaryStatus).toBe('COMPLETE');
    expect(doc.sourceVersion).toBe(1);
    expect(doc.tags.map((t) => t.tag.slug).sort()).toEqual(['busca', 'postgres']);
    const key = await db.preparedIngestKey.findUniqueOrThrow({
      where: { userId_key: { userId, key: `capture:${jobId}` } },
    });
    expect(key).toMatchObject({
      targetType: 'DOCUMENT',
      contractVersion: '2',
      producerId: 'voxen-capture',
    });
    expect((await db.job.findUniqueOrThrow({ where: { id: jobId } })).transcriptId).toBe(
      first.transcriptId,
    );

    const markdown = await storageReadText(doc.mdPath);
    expect(markdown).toContain('## Resumo');
    expect(markdown).toContain('## Conteúdo');
    expect(markdown).not.toContain('evil.example');
    expect(markdown).not.toContain('track.example');
    const { readSourceEvidenceManifest } = await import('../src/lib/source-provenance');
    const manifest = readSourceEvidenceManifest(
      markdown,
      (doc.sourceMetadata as { evidenceManifest: unknown }).evidenceManifest,
    );
    expect(manifest.spans.map((span) => markdown.slice(span.start, span.end).trim())).toEqual([
      text,
    ]);

    const hits = await db.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Transcript"
      WHERE "userId" = ${userId} AND "searchVector" @@ plainto_tsquery('portuguese', 'índices tsvector')
    `;
    expect(hits.map((h) => h.id)).toContain(first.transcriptId);
  });

  it('reprocess updates in place and snapshots the previous version once', async () => {
    const transcriptId = captureTranscriptId(jobId);
    await db.job.update({ where: { id: jobId }, data: { status: 'DONE' } });
    const refreshJob = await db.job.create({
      data: {
        userId,
        type: 'CAPTURE_LINK',
        status: 'RUNNING',
        sourceUrl: 'https://example.com/post',
        refreshTranscriptId: transcriptId,
      },
    });
    const input = {
      ...baseInput(userId, refreshJob.id, 'Texto novo sobre pg_trgm e ranking de resultados.'),
      refreshTranscriptId: transcriptId,
    };
    const result = await publishCapturedDocument(input);
    expect(result).toEqual({ transcriptId, created: false, changed: true });
    expect(await db.transcript.count({ where: { userId } })).toBe(1);

    const doc = await db.transcript.findUniqueOrThrow({ where: { id: transcriptId } });
    expect(doc.sourceVersion).toBe(2);
    expect(doc.plainText).toContain('pg_trgm');
    const canonicalChecksum = createHash('sha256')
      .update(await storageReadText(doc.mdPath))
      .digest('hex');
    expect(doc.mdPath).toBe(
      `workspaces/${userId}/transcripts/${transcriptId}/sources/v2-${canonicalChecksum}.md`,
    );
    const versions = await db.sourceContentVersion.findMany({ where: { transcriptId } });
    expect(versions.map((v) => v.version)).toEqual([1]);
    expect(versions[0]?.plainText).toContain('tsvector');
  });

  it('keeps the winning canonical object and span manifest consistent during a late duplicate publication', async () => {
    const job = await db.job.create({
      data: {
        userId,
        type: 'CAPTURE_LINK',
        status: 'RUNNING',
        sourceUrl: 'https://example.test/concurrent',
      },
    });
    const first = baseInput(
      userId,
      job.id,
      'A complete source body shared by both publication attempts.',
    );
    first.interpretation.title = 'First publication';
    const late = {
      ...first,
      interpretation: { ...first.interpretation, title: 'Late publication' },
    };
    const storage = await import('../src/lib/storage');
    const realPut = storage.storagePut;
    let entered!: () => void, release!: () => void;
    const paused = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const write = spyOn(storage, 'storagePut').mockImplementation(async (input) => {
      if (typeof input.body === 'string' && input.body.includes('title: "Late publication"')) {
        entered();
        await barrier;
      }
      return realPut(input);
    });
    const pending = publishCapturedDocument(late);
    try {
      await paused;
      const winner = await publishCapturedDocument(first);
      release();
      expect((await pending).created).toBe(false);
      const doc = await db.transcript.findFirstOrThrow({
        where: { id: winner.transcriptId, userId },
      });
      const markdown = await storageReadText(doc.mdPath);
      const { readSourceEvidenceManifest } = await import('../src/lib/source-provenance');
      expect(
        readSourceEvidenceManifest(
          markdown,
          (doc.sourceMetadata as { evidenceManifest: unknown }).evidenceManifest,
        ).spans.length,
      ).toBeGreaterThan(0);
      expect(markdown).toContain('# First publication');
      expect(markdown).not.toContain('# Late publication');
    } finally {
      release();
      write.mockRestore();
      await pending;
    }
  });

  it.each(['same job', 'different job'] as const)(
    'preserves the committed refresh when a late %s resumes from its old baseline',
    async (scenario) => {
      const initialJob = await db.job.create({
        data: {
          userId,
          type: 'CAPTURE_LINK',
          status: 'DONE',
          sourceUrl: `https://example.test/${scenario}/initial`,
        },
      });
      const initial = await publishCapturedDocument(
        baseInput(userId, initialJob.id, 'The original source before either refresh attempt.'),
      );
      const lateJob = await db.job.create({
        data: {
          userId,
          type: 'CAPTURE_LINK',
          status: 'RUNNING',
          sourceUrl: `https://example.test/${scenario}/late`,
          refreshTranscriptId: initial.transcriptId,
        },
      });
      const winnerJob =
        scenario === 'same job'
          ? lateJob
          : await db.job.create({
              data: {
                userId,
                type: 'CAPTURE_LINK',
                status: 'RUNNING',
                sourceUrl: `https://example.test/${scenario}/winner`,
                refreshTranscriptId: initial.transcriptId,
              },
            });
      const winnerInput = {
        ...baseInput(userId, winnerJob.id, 'The source committed by the winning refresh attempt.'),
        refreshTranscriptId: initial.transcriptId,
      };
      winnerInput.interpretation.title = 'Winning refresh';
      winnerInput.artifact.segments = [
        { startSec: 0, endSec: 5, text: 'A chunk from the winning refresh.' },
      ];
      const lateInput = {
        ...baseInput(
          userId,
          lateJob.id,
          'The different source rendered by the late refresh attempt.',
        ),
        refreshTranscriptId: initial.transcriptId,
      };
      lateInput.interpretation.title = 'Late refresh';
      lateInput.artifact.segments = [
        { startSec: 0, endSec: 5, text: 'A chunk from the late refresh.' },
      ];
      const storage = await import('../src/lib/storage');
      const realPut = storage.storagePut;
      let entered!: () => void, release!: () => void;
      const paused = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      const write = spyOn(storage, 'storagePut').mockImplementation(async (input) => {
        if (typeof input.body === 'string' && input.body.includes('title: "Late refresh"')) {
          entered();
          await barrier;
        }
        return realPut(input);
      });
      const pending = publishCapturedDocument(lateInput);
      try {
        await paused;
        await publishCapturedDocument(winnerInput);
        const where = { id: initial.transcriptId, userId };
        const committed = await db.transcript.findFirstOrThrow({ where });
        const snapshots = await db.sourceContentVersion.findMany({
          where: { transcriptId: initial.transcriptId, userId },
        });
        const chunks = await db.chunk.findMany({ where: { transcriptId: initial.transcriptId } });
        expect(committed.sourceVersion).toBe(2);
        expect(snapshots).toHaveLength(1);
        release();
        if (scenario === 'same job')
          expect(await pending).toEqual({
            transcriptId: initial.transcriptId,
            created: false,
            changed: false,
          });
        else await expect(pending).rejects.toMatchObject({ code: 'STALE_REVISION' });
        expect(await db.transcript.findFirstOrThrow({ where })).toEqual(committed);
        expect(
          await db.sourceContentVersion.findMany({
            where: { transcriptId: initial.transcriptId, userId },
          }),
        ).toEqual(snapshots);
        expect(await db.chunk.findMany({ where: { transcriptId: initial.transcriptId } })).toEqual(
          chunks,
        );
        const markdown = await storageReadText(committed.mdPath);
        const { readSourceEvidenceManifest } = await import('../src/lib/source-provenance');
        expect(
          readSourceEvidenceManifest(
            markdown,
            (committed.sourceMetadata as { evidenceManifest: unknown }).evidenceManifest,
          ).spans.length,
        ).toBeGreaterThan(0);
        expect(markdown).toContain('# Winning refresh');
        if (scenario === 'different job') {
          await publishCapturedDocument(lateInput);
          expect((await db.transcript.findFirstOrThrow({ where })).sourceVersion).toBe(3);
          expect(
            await db.sourceContentVersion.findFirstOrThrow({
              where: { transcriptId: initial.transcriptId, userId, version: 2 },
            }),
          ).toMatchObject({
            mdPath: committed.mdPath,
            metadata: committed.sourceMetadata,
            checksum: committed.sourceChecksum,
          });
        }
      } finally {
        release();
        write.mockRestore();
        await Promise.allSettled([pending]);
      }
    },
  );
});
