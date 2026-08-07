// ============================================================================
// Gera resumo estruturado de Transcript via OpenRouter (direto no web).
// Shared transcript-summary path for the integrated web runtime.
// ============================================================================

import { db } from './db';
import { getAppLanguage, getSettings, type AppLanguage } from './settings';
import { queueTranscriptResearch } from './transcript-enrichments';

const OR_BASE_URL = 'https://openrouter.ai/api/v1';

export function buildSummarizePrompt(language: AppLanguage): string {
  if (language === 'en') {
    return `You receive a video transcript. Produce a SUMMARY in markdown,
in English, structured exactly like this:

## In short
2-3 sentences capturing the essence of the video.

## Key points
- A list of 4 to 8 bullets, each with the core idea. When useful, cite the
  passage with a minute timestamp in the format \`[mm:ss]\` (or \`[hh:mm:ss]\` if > 1h).

## Conclusion
A short paragraph with the main takeaway.

RULES:
- Do not invent content. Only use what is in the transcript.
- Clear, direct English. No emojis.
- Do not use English acronyms for the short summary section (never "too long; didn't read").
- Do not add an extra top-level heading; start directly with "## In short".`;
  }

  return `Você recebe a transcrição de um vídeo. Produza um RESUMO em markdown,
em português brasileiro, estruturado assim:

## Em poucas linhas
2-3 frases capturando a essência do vídeo.

## Principais pontos
- Lista de 4 a 8 bullets, cada um com a ideia central. Quando útil, cite o
  trecho referenciando o minuto no formato \`[mm:ss]\` (ou \`[hh:mm:ss]\` se > 1h).

## Conclusão
Parágrafo curto com a mensagem principal ou take-away.

REGRAS:
- Não invente conteúdo. Só use o que está na transcrição.
- Português direto, sem rodeios. Sem emojis.
- Não use abreviações em inglês para o resumo curto (nunca "too long; didn't read").
- Não adicione cabeçalho extra; comece direto pelo "## Em poucas linhas".`;
}

/** @deprecated Use buildSummarizePrompt(await getAppLanguage()) */
export const SUMMARIZE_PROMPT = buildSummarizePrompt('pt-BR');

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
  abortSignal?: AbortSignal;
}): Promise<string> {
  const settings = await getSettings([
    'openrouter_api_key',
    'default_chat_model',
    'summary_timeout_sec',
  ] as const);
  const apiKey = settings.openrouter_api_key;
  if (!apiKey) {
    throw new TranscriptSummaryError('Setup incompleto — chave OpenRouter ausente.', 412);
  }
  const model = settings.default_chat_model;
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

  const timeoutSecRaw = settings.summary_timeout_sec;
  let timeoutMs = 120_000;
  if (timeoutSecRaw) {
    const parsed = Number(timeoutSecRaw);
    if (Number.isFinite(parsed) && parsed >= 30 && parsed <= 600) {
      timeoutMs = Math.round(parsed * 1000);
    }
  }

  const language = await getAppLanguage();
  const prompt = buildSummarizePrompt(language);
  const titleLabel = language === 'en' ? 'Video title' : 'Título do vídeo';
  const bodyLabel = language === 'en' ? 'Transcript' : 'Transcrição';

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
          { role: 'system', content: prompt },
          {
            role: 'user',
            content: `${titleLabel}: ${input.title}\n\n${bodyLabel}:\n\n${text}`,
          },
        ],
        stream: false,
        usage: { include: true },
      }),
      signal: input.abortSignal
        ? AbortSignal.any([input.abortSignal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const name =
      typeof err === 'object' && err !== null && 'name' in err
        ? String((err as { name?: unknown }).name)
        : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new TranscriptSummaryError(
        'A OpenRouter não respondeu no prazo. Tente novamente.',
        502,
      );
    }
    throw new TranscriptSummaryError(
      'Não foi possível contatar a OpenRouter. Tente novamente.',
      502,
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new TranscriptSummaryError('Chave OpenRouter rejeitada.', 412);
  }
  if (!res.ok) {
    throw new TranscriptSummaryError(
      `OpenRouter retornou status ${res.status} ao gerar o resumo.`,
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
      meta: {
        source: 'transcript_summary',
        transcript_id: input.transcriptId,
        language,
      },
    },
  });

  // A pesquisa é uma segunda etapa durável e opcional. A própria fila aplica
  // a política OFF/MANUAL/AUTO e nunca altera o resumo canônico acima.
  await queueTranscriptResearch({
    userId: input.userId,
    transcriptId: input.transcriptId,
    trigger: 'AUTO',
  }).catch(() => undefined);

  return summary;
}
