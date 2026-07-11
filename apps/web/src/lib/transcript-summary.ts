// ============================================================================
// Gera resumo estruturado de Transcript via OpenRouter (direto no web).
// Substitui o antigo proxy HTTP pro apps/chat /summarize-transcript.
// ============================================================================

import { db } from './db';
import { getSetting } from './settings';

const OR_BASE_URL = 'https://openrouter.ai/api/v1';

export const SUMMARIZE_PROMPT = `Você recebe a transcrição de um vídeo. Produza um RESUMO em markdown,
em português brasileiro, estruturado assim:

## TL;DR
2-3 frases capturando a essência do vídeo.

## Principais pontos
- Lista de 4 a 8 bullets, cada um com a ideia central. Quando útil, cite o
  trecho referenciando o minuto no formato \`[mm:ss]\` (ou \`[hh:mm:ss]\` se > 1h).

## Conclusão
Parágrafo curto com a mensagem principal ou take-away.

REGRAS:
- Não invente conteúdo. Só use o que está na transcrição.
- Português direto, sem rodeios. Sem emojis.
- Não adicione cabeçalho extra; comece direto pelo "## TL;DR".`;

export class TranscriptSummaryError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'TranscriptSummaryError';
  }
}

export async function generateAndPersistTranscriptSummary(input: {
  userId: string;
  transcriptId: string;
  title: string;
  plainText: string;
}): Promise<string> {
  const apiKey = await getSetting('openrouter_api_key');
  if (!apiKey) {
    throw new TranscriptSummaryError('Setup incompleto — chave OpenRouter ausente.', 412);
  }
  const model = await getSetting('default_chat_model');
  if (!model) {
    throw new TranscriptSummaryError('Setup incompleto — modelo de chat ausente.', 412);
  }

  let text = input.plainText.trim();
  if (!text) {
    throw new TranscriptSummaryError('Texto vazio.', 422);
  }
  if (text.length > 60_000) {
    text = text.slice(0, 60_000) + '\n\n[…transcrição truncada para resumo…]';
  }

  const timeoutSecRaw = await getSetting('summary_timeout_sec');
  let timeoutMs = 120_000;
  if (timeoutSecRaw) {
    const parsed = Number(timeoutSecRaw);
    if (Number.isFinite(parsed) && parsed >= 30 && parsed <= 600) {
      timeoutMs = Math.round(parsed * 1000);
    }
  }

  let res: Response;
  try {
    res = await fetch(`${OR_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SUMMARIZE_PROMPT },
          {
            role: 'user',
            content: `Título do vídeo: ${input.title}\n\nTranscrição:\n\n${text}`,
          },
        ],
        stream: false,
        usage: { include: true },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new TranscriptSummaryError(`Falha ao contatar OpenRouter: ${msg}`, 502);
  }

  if (res.status === 401 || res.status === 403) {
    throw new TranscriptSummaryError('Chave OpenRouter rejeitada.', 412);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new TranscriptSummaryError(
      `OpenRouter ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
      502,
    );
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number | string };
  };
  const summary = (data.choices?.[0]?.message?.content ?? '').trim();
  if (!summary) {
    throw new TranscriptSummaryError('Modelo retornou resumo vazio.', 502);
  }

  const tokensIn = Number(data.usage?.prompt_tokens ?? 0) || 0;
  const tokensOut = Number(data.usage?.completion_tokens ?? 0) || 0;
  let costUsd = '0';
  if (data.usage?.cost != null) {
    costUsd = String(data.usage.cost);
  }

  await db.transcript.updateMany({
    where: { id: input.transcriptId, userId: input.userId },
    data: { summaryMd: summary },
  });

  await db.costEvent.create({
    data: {
      userId: input.userId,
      kind: 'CHAT',
      model,
      tokensIn,
      tokensOut,
      costUsd,
      meta: { source: 'transcript_summary', transcript_id: input.transcriptId },
    },
  });

  return summary;
}
