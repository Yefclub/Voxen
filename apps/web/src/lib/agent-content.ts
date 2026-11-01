import { db } from './db';
import { findRelated } from './retrieval';

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
  _options: { abortSignal?: AbortSignal } = {},
): Promise<TranscriptBrief> {
  const transcript = await db.transcript.findFirst({
    where: { id: transcriptId, userId, status: 'ACTIVE' },
    select: {
      id: true,
      title: true,
      url: true,
      summaryMd: true,
      tags: { select: { tag: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
    },
  });
  if (!transcript) throw new Error('Transcrição não encontrada.');

  // Stored values only (spec 215): reads never trigger inference. Missing
  // summaries/tags stay missing until an external producer supplies them.
  const summary = transcript.summaryMd;
  const tags = transcript.tags.map((item) => item.tag.name);

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
    if (job.status === 'DONE' || job.status === 'COMPLETED_WITH_WARNINGS') {
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
