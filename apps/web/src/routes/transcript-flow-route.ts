import type { Context } from 'hono';
import { db } from '../lib/db';
import { rateLimit } from '../lib/rate-limit';
import { safeErrorDiagnostic } from '../lib/safe-diagnostics';
import { generateAndPersistTranscriptFlow, TranscriptFlowError } from '../lib/transcript-flow';

const FLOW_MIN_INTERVAL_SEC = 60;
type TranscriptRouteContext = Context<{ Variables: { userId: string } }>;

export async function generateTranscriptFlowRoute(c: TranscriptRouteContext): Promise<Response> {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as { force?: boolean };
  const force = body.force === true;

  const transcript = await db.transcript.findFirst({
    where: { id, userId, status: { not: 'TRASH' } },
    select: {
      id: true,
      title: true,
      plainText: true,
      correctedPlainText: true,
      correctionState: true,
      summaryMd: true,
      flowchartMd: true,
      correctionRevision: true,
    },
  });
  if (!transcript) return c.json({ error: 'Transcrição não encontrada.' }, 404);
  const effectivePlainText =
    transcript.correctionState === 'ACTIVE' && transcript.correctedPlainText
      ? transcript.correctedPlainText
      : transcript.plainText;
  if (!effectivePlainText.trim()) {
    return c.json({ error: 'Transcrição sem texto para gerar um fluxo.' }, 422);
  }
  if (transcript.flowchartMd && !force) {
    return c.json(
      { error: 'Fluxo já existe. Use { "force": true } para regenerar.', existing: true },
      409,
    );
  }
  const rl = await rateLimit(`voxen:rl:flow:${userId}:${id}`, 1, FLOW_MIN_INTERVAL_SEC);
  if (!rl.allowed) {
    return c.json(
      { error: `Aguarde ${rl.resetIn}s antes de regenerar este fluxo.`, retryAfter: rl.resetIn },
      429,
    );
  }

  try {
    const flowchartMd = await generateAndPersistTranscriptFlow({
      userId,
      transcriptId: transcript.id,
      title: transcript.title,
      summaryMd: transcript.summaryMd,
      plainText: effectivePlainText,
      correctionRevision: transcript.correctionRevision,
    });
    return c.json({ flowchartMd });
  } catch (error) {
    if (error instanceof TranscriptFlowError) {
      return c.json({ error: error.message }, error.status as 400);
    }
    console.error(
      '[transcripts] flow generation failed',
      safeErrorDiagnostic('TRANSCRIPT_FLOW_FAILED', error),
    );
    return c.json({ error: 'Falha ao gerar fluxo.' }, 502);
  }
}
