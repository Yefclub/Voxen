// ============================================================================
// Geração de título via OpenRouter (espelho do worker).
// Usado no backfill "Regenerar títulos" da biblioteca. Mantém a lógica de
// apps/worker/src/openrouter.py::generate_content_title em sincronia:
//   - reasoning desabilitado (issue #335, evita vazar preâmbulo no content)
//   - KEEP só quando o candidato já é bom E no idioma-alvo
//   - rejeição de preâmbulo/raciocínio vazado
// ============================================================================

import { getAppLanguage, getSetting, type AppLanguage } from './settings';

const OR_BASE_URL = 'https://openrouter.ai/api/v1';

// Prefixos de preâmbulo/raciocínio que o modelo às vezes cospe em vez de um
// título (issue #335). SEM 'here is'/'here''s' (falso-positivo em título
// inglês legítimo, ex.: "Here Is New York").
const TITLE_META_PREFIXES = [
  'the candidate title',
  'the user wants',
  'the user is',
  'the user asked',
  'the final title',
  'a good title',
  'based on the content',
  'the content is about',
  'let me',
  "i'll",
  'i will',
  'i would',
  'sure,',
  'okay,',
  'título:',
  'título final',
  'title:',
];

function looksLikeTitlePreamble(title: string): boolean {
  const low = title.trim().toLowerCase();
  if (!low) return false;
  return TITLE_META_PREFIXES.some((prefix) => low.startsWith(prefix));
}

const TRIM_EDGE = /^[\s"'“”‘’#:-]+|[\s"'“”‘’#:-]+$/g;

export function cleanGeneratedTitle(value: string): string {
  let title = value
    .replace(/\n/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
    .replace(TRIM_EDGE, '');
  if (!title) return '';
  if (title.length > 90) {
    const cut = title.slice(0, 90);
    const lastSpace = cut.lastIndexOf(' ');
    title = lastSpace > 0 ? cut.slice(0, lastSpace) : title.slice(0, 80);
  }
  return title.replace(/^[\s.]+|[\s.]+$/g, '');
}

// Interpreta a resposta do modelo: KEEP / título idêntico / preâmbulo → mantém
// o candidato; senão usa o título novo saneado.
export function resolveTitleDecision(raw: string, fallbackTitle: string): string {
  const cleaned = cleanGeneratedTitle(raw);
  const fallbackClean = cleanGeneratedTitle(fallbackTitle) || fallbackTitle.trim();
  if (!cleaned) return fallbackClean;
  const token = cleaned.toUpperCase();
  if (['KEEP', 'MANTER', 'KEEP TITLE', 'KEEP_TITLE'].includes(token)) return fallbackClean;
  if (fallbackClean && cleaned.toLowerCase() === fallbackClean.toLowerCase()) return fallbackClean;
  if (looksLikeTitlePreamble(cleaned)) return fallbackClean;
  return cleaned;
}

function buildTitlePrompt(
  candidate: string,
  sourceLabel: string,
  content: string,
  language: AppLanguage,
): { system: string; user: string } {
  const excerpt = content.trim().slice(0, 8000);
  if (language === 'en') {
    return {
      system:
        'You pick precise titles for a personal knowledge base. ' +
        'Reply only with KEEP or the final title.',
      user:
        `Source: ${sourceLabel}\n` +
        `Candidate title: ${candidate || '(empty)'}\n\n` +
        'You choose the final title for this content in a personal knowledge base.\n' +
        'Rules:\n' +
        '1. If the candidate is already a good editorial title (clear, specific, ' +
        'useful to find later), reply exactly: KEEP\n' +
        '2. Otherwise reply only with a short English editorial title ' +
        '(max 80 characters). No quotes. No trailing period. ' +
        'Preserve proper names and the main topic.\n' +
        '3. Weak titles to replace: filename, generic ID, hostname, ' +
        "'X post …', '(no title)', emoji-only, or overly vague titles.\n" +
        '\n\n' +
        `Content:\n${excerpt}`,
    };
  }
  return {
    system:
      'Você escolhe títulos precisos, em português do Brasil, para uma base de ' +
      'conhecimento pessoal. Responda apenas com KEEP (somente se o candidato já ' +
      'estiver em português do Brasil) ou com o título final em português.',
    user:
      `Fonte: ${sourceLabel}\n` +
      `Título candidato: ${candidate || '(vazio)'}\n\n` +
      'Você decide o título final deste conteúdo para uma base de conhecimento pessoal.\n' +
      'O título final DEVE estar em português do Brasil.\n' +
      'Regras:\n' +
      '1. Só responda KEEP se o título candidato já for um bom título editorial ' +
      '(claro, específico, útil para achar o conteúdo depois) E já estiver em ' +
      'português do Brasil.\n' +
      '2. Caso contrário, responda apenas com um título editorial curto em português ' +
      'do Brasil (máximo 80 caracteres). Isso inclui TRADUZIR/adaptar para o ' +
      'português um título que esteja em outro idioma, mesmo que ele já seja bom. ' +
      'Não use aspas. Não use ponto final. Preserve nomes próprios, marcas e ' +
      'títulos de obras.\n' +
      '3. Títulos fracos a substituir: nome de arquivo, ID genérico, hostname, ' +
      "'Post do X …', '(sem título)', só emoji, ou título vago demais.\n" +
      '\n\n' +
      `Conteúdo:\n${excerpt}`,
  };
}

export interface TitleGenerationResult {
  title: string;
  changed: boolean;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: string;
}

/**
 * Regenera o título editorial de um conteúdo via OpenRouter. `changed` indica
 * se o título final difere do atual (`title`). Não persiste — quem chama decide.
 */
export async function generateTitleForContent(input: {
  title: string;
  content: string;
  sourceLabel: string;
}): Promise<TitleGenerationResult> {
  const apiKey = await getSetting('openrouter_api_key');
  const model = await getSetting('default_chat_model');
  if (!apiKey || !model) {
    throw new Error('Setup incompleto — OpenRouter/modelo ausentes.');
  }
  const language = await getAppLanguage();
  const candidate = cleanGeneratedTitle(input.title) || input.title.trim();
  const { system, user } = buildTitlePrompt(candidate, input.sourceLabel, input.content, language);

  const res = await fetch(`${OR_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.2,
      max_tokens: 64,
      // Título é one-shot curto: sem reasoning para o raciocínio não vazar no
      // content (issue #335). Modelos sem reasoning ignoram o campo.
      reasoning: { enabled: false },
      usage: { include: true },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${res.status}${body ? `: ${body.slice(0, 160)}` : ''}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number | string };
    model?: string;
  };
  const raw = (data.choices?.[0]?.message?.content ?? '').trim();
  const resolved = resolveTitleDecision(raw, candidate || input.title);
  const finalTitle = resolved || candidate || input.title.slice(0, 80) || 'Conteúdo sem título';

  return {
    title: finalTitle,
    changed: finalTitle !== input.title,
    model: data.model ?? model,
    tokensIn: Number(data.usage?.prompt_tokens ?? 0) || 0,
    tokensOut: Number(data.usage?.completion_tokens ?? 0) || 0,
    costUsd: data.usage?.cost != null ? String(data.usage.cost) : '0',
  };
}
