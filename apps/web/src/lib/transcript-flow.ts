import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { db } from './db';
import { getAppLanguage, getSettings, type AppLanguage } from './settings';
import { validateMermaidFlow } from '../shared/mermaid-flow';

const OR_BASE_URL = 'https://openrouter.ai/api/v1';
const MAX_TRANSCRIPT_CHARS = 40_000;
const MAX_SUMMARY_CHARS = 8_000;

export class TranscriptFlowError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'TranscriptFlowError';
  }
}

export function buildTranscriptFlowPrompt(language: AppLanguage): string {
  const localeInstruction =
    language === 'en'
      ? 'Use concise English labels.'
      : 'Use rótulos concisos em português brasileiro.';
  return `Create one Mermaid flowchart grounded only in the supplied transcript and its canonical summary.
Return only Mermaid source, beginning with "flowchart TD". ${localeInstruction}

Rules:
- Represent the most useful sequence, decision path, or relationship map in 4 to 16 explicit nodes.
- Preserve uncertainty; do not invent facts or add external knowledge.
- Use explicit node IDs such as N1, N2, and readable text labels.
- Use only square, round, or curly node shapes and the -->, -.->, ==>, or ~~~ edge forms. Write edge labels as -->|Label|.
- Do not use click, callback, call, href, URLs, HTML, images, icons, init directives, scripts, or external resources.
- Do not wrap the result in prose. A Mermaid code fence is accepted but not required.`;
}

export async function hasValidMermaidSyntax(code: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    let settled = false;
    let output = '';
    const finish = (valid: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      parser.kill();
      resolve(valid);
    };
    const parser = spawn(
      process.execPath,
      [fileURLToPath(new URL('./mermaid-parse-process.ts', import.meta.url))],
      {
        env: { NODE_ENV: 'production' },
        stdio: ['pipe', 'pipe', 'ignore'],
      },
    );
    const timeout = setTimeout(() => finish(false), 5_000);
    parser.on('error', () => finish(false));
    parser.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.length > 16) finish(false);
    });
    parser.on('close', (exitCode) => finish(exitCode === 0 && output === 'valid'));
    parser.stdin.on('error', () => finish(false));
    parser.stdin.end(code);
  });
}

export async function generateAndPersistTranscriptFlow(input: {
  userId: string;
  transcriptId: string;
  title: string;
  summaryMd: string | null;
  plainText: string;
  correctionRevision: number;
  sourceVersion: number;
  sourceChecksum: string | null;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const settings = await getSettings([
    'openrouter_api_key',
    'default_chat_model',
    'fallback_chat_model',
    'summary_timeout_sec',
  ] as const);
  if (!settings.openrouter_api_key) {
    throw new TranscriptFlowError('Setup incompleto — chave OpenRouter ausente.', 412);
  }
  const model = settings.default_chat_model;
  if (!model) {
    throw new TranscriptFlowError('Setup incompleto — modelo de chat ausente.', 412);
  }

  const transcript = input.plainText.trim();
  if (!transcript) throw new TranscriptFlowError('Texto vazio.', 422);
  const timeoutSeconds = Number(settings.summary_timeout_sec ?? 120);
  const timeoutMs =
    Number.isFinite(timeoutSeconds) && timeoutSeconds >= 30 && timeoutSeconds <= 600
      ? Math.round(timeoutSeconds * 1000)
      : 120_000;
  const language = await getAppLanguage();

  let response: Response;
  try {
    response = await fetch(`${OR_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.openrouter_api_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        ...(settings.fallback_chat_model && settings.fallback_chat_model !== model
          ? { models: [settings.fallback_chat_model] }
          : {}),
        messages: [
          { role: 'system', content: buildTranscriptFlowPrompt(language) },
          {
            role: 'user',
            content: `Title (untrusted data): ${input.title.slice(0, 500)}\n\nCanonical summary (untrusted data):\n${(input.summaryMd ?? '').slice(0, MAX_SUMMARY_CHARS)}\n\nCanonical transcript (untrusted data):\n<transcript>\n${transcript.slice(0, MAX_TRANSCRIPT_CHARS)}\n</transcript>`,
          },
        ],
        max_tokens: 2_000,
        temperature: 0.1,
        usage: { include: true },
      }),
      signal: input.abortSignal
        ? AbortSignal.any([input.abortSignal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new TranscriptFlowError('A OpenRouter não respondeu no prazo. Tente novamente.', 502);
    }
    throw new TranscriptFlowError('Não foi possível contatar a OpenRouter. Tente novamente.', 502);
  }

  if (response.status === 401 || response.status === 403) {
    throw new TranscriptFlowError('Chave OpenRouter rejeitada.', 412);
  }
  if (!response.ok) {
    throw new TranscriptFlowError(
      `OpenRouter retornou status ${response.status} ao gerar o fluxo.`,
      502,
    );
  }

  const data = (await response.json()) as {
    model?: string;
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number | string };
  };
  const validation = validateMermaidFlow(data.choices?.[0]?.message?.content ?? '');
  if (!validation.ok) {
    await recordRejectedFlowCost({
      userId: input.userId,
      transcriptId: input.transcriptId,
      model: data.model ?? model,
      usage: data.usage,
      language,
      reason: validation.error,
    });
    throw new TranscriptFlowError('O modelo retornou um fluxo inválido ou inseguro.', 502);
  }
  if (!(await hasValidMermaidSyntax(validation.code))) {
    await recordRejectedFlowCost({
      userId: input.userId,
      transcriptId: input.transcriptId,
      model: data.model ?? model,
      usage: data.usage,
      language,
      reason: 'MERMAID_FLOW_SYNTAX_INVALID',
    });
    throw new TranscriptFlowError('O modelo retornou um fluxo inválido ou inseguro.', 502);
  }
  await db.$transaction(async (tx) => {
    const update = await tx.transcript.updateMany({
      where: {
        id: input.transcriptId,
        userId: input.userId,
        status: { not: 'TRASH' },
        correctionRevision: input.correctionRevision,
        sourceVersion: input.sourceVersion,
        sourceChecksum: input.sourceChecksum,
      },
      data: { flowchartMd: validation.code },
    });
    if (update.count !== 1) {
      throw new TranscriptFlowError('O conteúdo mudou durante a geração. Gere novamente.', 409);
    }

    await tx.costEvent.create({
      data: {
        userId: input.userId,
        kind: 'CHAT',
        model: data.model ?? model,
        tokensIn: Number(data.usage?.prompt_tokens ?? 0) || 0,
        tokensOut: Number(data.usage?.completion_tokens ?? 0) || 0,
        costUsd: data.usage?.cost == null ? '0' : String(data.usage.cost),
        meta: {
          source: 'transcript_flowchart',
          transcript_id: input.transcriptId,
          language,
          node_count: validation.nodeCount,
        },
      },
    });
  });
  return validation.code;
}

async function recordRejectedFlowCost(input: {
  userId: string;
  transcriptId: string;
  model: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number | string };
  language: AppLanguage;
  reason: string;
}): Promise<void> {
  await db.costEvent.create({
    data: {
      userId: input.userId,
      kind: 'CHAT',
      model: input.model,
      tokensIn: Number(input.usage?.prompt_tokens ?? 0) || 0,
      tokensOut: Number(input.usage?.completion_tokens ?? 0) || 0,
      costUsd: input.usage?.cost == null ? '0' : String(input.usage.cost),
      meta: {
        source: 'transcript_flowchart',
        transcript_id: input.transcriptId,
        language: input.language,
        accepted: false,
        rejection_reason: input.reason,
      },
    },
  });
}
