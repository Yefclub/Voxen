import { db } from './db';
import { findRelated } from './retrieval';
import { generateTagsForContent } from './tags-generate';
import { applyTagsToTranscript } from './tags';
import { generateAndPersistTranscriptSummary } from './transcript-summary';

export type TranscriptBrief = {
  transcriptId: string;
  title: string;
  url: string;
  summary: string | null;
  tags: string[];
  related: Awaited<ReturnType<typeof findRelated>>;
  nextStep: string;
};

export async function getTranscriptBrief(
  userId: string,
  transcriptId: string,
  options: { enrichMissing?: boolean; abortSignal?: AbortSignal } = {},
): Promise<TranscriptBrief> {
  const transcript = await db.transcript.findFirst({
    where: { id: transcriptId, userId, status: 'ACTIVE' },
    select: {
      id: true,
      title: true,
      url: true,
      plainText: true,
      summaryMd: true,
      folderId: true,
      tags: { select: { tag: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
    },
  });
  if (!transcript) throw new Error('Transcrição não encontrada.');

  let summary = transcript.summaryMd;
  if (options.enrichMissing !== false && !summary && transcript.plainText.trim()) {
    try {
      summary = await generateAndPersistTranscriptSummary({
        userId,
        transcriptId: transcript.id,
        title: transcript.title,
        plainText: transcript.plainText,
        abortSignal: options.abortSignal,
      });
    } catch (error) {
      if (options.abortSignal?.aborted) throw error;
      summary = null;
    }
  }

  let tags = transcript.tags.map((item) => item.tag.name);
  if (options.enrichMissing !== false && tags.length === 0 && transcript.plainText.trim()) {
    const existingTags = (
      await db.tag.findMany({ where: { userId }, select: { name: true }, orderBy: { name: 'asc' } })
    ).map((item) => item.name);
    let generated = null;
    try {
      generated = await generateTagsForContent({
        title: transcript.title,
        content: summary || transcript.plainText,
        existingTags,
        abortSignal: options.abortSignal,
      });
    } catch (error) {
      if (options.abortSignal?.aborted) throw error;
    }
    if (generated?.tags.length) {
      const applied = await applyTagsToTranscript(
        userId,
        { id: transcript.id, folderId: transcript.folderId },
        generated.tags,
      );
      tags = applied.map((item) => item.name);
      await db.costEvent.create({
        data: {
          userId,
          kind: 'CHAT',
          model: generated.model,
          tokensIn: generated.tokensIn,
          tokensOut: generated.tokensOut,
          costUsd: generated.costUsd,
          meta: {
            source: 'agent_transcript_tags',
            transcript_id: transcript.id,
            generated_count: tags.length,
          },
        },
      });
    }
  }

  const related = await findRelated(userId, { transcriptId: transcript.id, limit: 5 }).catch(
    () => [],
  );
  return {
    transcriptId: transcript.id,
    title: transcript.title,
    url: transcript.url,
    summary,
    tags,
    related,
    nextStep:
      'Use outline_transcript/read_section para detalhes; read_transcript somente se o brief não bastar.',
  };
}

export async function waitForTranscriptJob(options: {
  userId: string;
  jobId: string;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  onProgress?: (status: string) => void;
}): Promise<TranscriptBrief> {
  const deadline = Date.now() + (options.timeoutMs ?? 10 * 60_000);
  let lastStatus = '';
  let lastProgressAt = 0;
  // Progresso a cada 5s: alimenta status SSE e reduz risco de proxy/Bun idle.
  const progressEveryMs = 5_000;
  while (Date.now() < deadline) {
    if (options.abortSignal?.aborted) throw new Error('Transcrição interrompida.');
    const job = await db.job.findFirst({
      where: { id: options.jobId, userId: options.userId },
      select: { status: true, transcriptId: true, errorMsg: true },
    });
    if (!job) throw new Error('Job de transcrição não encontrado.');
    if (job.status !== lastStatus || Date.now() - lastProgressAt >= progressEveryMs) {
      lastStatus = job.status;
      lastProgressAt = Date.now();
      options.onProgress?.(job.status);
    }
    if (job.status === 'DONE') {
      if (!job.transcriptId) throw new Error('Job concluído sem transcrição.');
      return getTranscriptBrief(options.userId, job.transcriptId, {
        abortSignal: options.abortSignal,
      });
    }
    if (job.status === 'FAILED' || job.status === 'CANCELLED') {
      throw new Error(job.errorMsg || `Transcrição ${job.status.toLowerCase()}.`);
    }
    await new Promise<void>((resolve, reject) => {
      let abort = () => {};
      const finish = () => {
        options.abortSignal?.removeEventListener('abort', abort);
        resolve();
      };
      const timer = setTimeout(finish, 2_000);
      abort = () => {
        clearTimeout(timer);
        options.abortSignal?.removeEventListener('abort', abort);
        reject(new Error('Transcrição interrompida.'));
      };
      options.abortSignal?.addEventListener('abort', abort, { once: true });
    });
  }
  throw new Error('A transcrição excedeu o tempo de espera. Ela continuará na fila.');
}
