// ============================================================================
// Geração de tags de conteúdo via OpenRouter (spec 075).
// Espelha o padrão de folder-classify.ts / title-generate.ts:
//   - pega apiKey + modelo de settings (DB, cifrado)
//   - pede ao modelo poucas tags (reusando as existentes)
//   - pós-processamento determinístico: slug, dedup, cap
// ============================================================================

import { getAppLanguage, getSettings, type AppLanguage } from './settings';

const OR_BASE_URL = 'https://openrouter.ai/api/v1';

export const MAX_TAGS = 5;

// Frases/raciocínio que o modelo às vezes cospe no lugar de uma tag curta.
// Match por substring (não só prefixo): "Looking at the content" não começa com
// "the content", mas ainda é ruído de raciocínio.
const TAG_BAD_MARKERS = [
  'the content',
  'this content',
  'looking at',
  'its about',
  "it's about",
  'it is about',
  'the user',
  'i want',
  'i will',
  'i need',
  'let me',
  'here are',
  'here is',
  'the tags',
  'as tags',
  'tags total',
  'json array only',
  'return json only',
  'no duplicates',
  'no sentences',
  'o conteúdo',
  'este conteúdo',
] as const;

// Rótulos genéricos demais para virar tag útil.
const TAG_STOP_LABELS = new Set([
  'content',
  'conteúdo',
  'conteudo',
  'misc',
  'other',
  'others',
  'outros',
  'geral',
  'general',
  'various',
  'stuff',
  'video',
  'vídeo',
  'tag',
  'tags',
  'none',
  'nenhuma',
  'n/a',
  'na',
  'null',
  'i see',
]);

/**
 * Normaliza um nome de tag para slug: minúsculas, sem acento, só `[a-z0-9-]`.
 * É a chave de deduplicação por usuário (UNIQUE userId, slug).
 */
export function slugifyTag(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove diacríticos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // não-alfanumérico → hífen
    .replace(/^-+|-+$/g, '') // trim hífens
    .slice(0, 60);
}

// Limpa um candidato bruto para um nome curto e apresentável, ou retorna null.
function cleanTagName(raw: string): string | null {
  let name = (raw || '')
    .replace(/\n/g, ' ')
    .replace(/[#*`]/g, '')
    .replace(/["'“”‘’]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
    .trim()
    .replace(/^[\s.,:;\-–—]+|[\s.,:;\-–—]+$/g, '');
  if (!name) return null;

  const lower = name.toLocaleLowerCase('en-US');
  if (TAG_BAD_MARKERS.some((m) => lower.includes(m))) return null;

  const words = name.split(/\s+/).filter(Boolean);
  if (words.length > 4) return null; // tag deve ser curta (1-4 palavras)
  if (name.length > 40) name = name.slice(0, 40).replace(/\s+\S*$/, '') || name.slice(0, 40);
  name = name.replace(/^[\s.,:;\-–—]+|[\s.,:;\-–—]+$/g, '').trim();
  if (name.length < 2) return null;
  if (TAG_STOP_LABELS.has(name.toLocaleLowerCase('pt-BR'))) return null;
  if (!slugifyTag(name)) return null;
  return name;
}

// Extrai um array de strings de uma resposta que pode ser JSON (array ou objeto
// com chave tags/labels) ou texto solto (linhas / vírgulas).
function extractCandidates(raw: string): string[] {
  const text = (raw || '').trim();
  if (!text) return [];

  // Tenta JSON (array direto, objeto {tags:[...]}, ou dentro de fence).
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const jsonSource = fence?.[1] ?? text;
  const arrMatch = jsonSource.match(/\[[\s\S]*\]/);
  const objMatch = jsonSource.match(/\{[\s\S]*\}/);
  for (const candidate of [arrMatch?.[0], objMatch?.[0]]) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((v): v is string => typeof v === 'string');
      }
      if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>;
        for (const key of ['tags', 'labels', 'tag', 'categories']) {
          const val = obj[key];
          if (Array.isArray(val)) return val.filter((v): v is string => typeof v === 'string');
          if (typeof val === 'string') return [val];
        }
      }
    } catch {
      // cai para fallback textual
    }
  }

  // Fallback: linhas / vírgulas / bullets.
  return text
    .split(/[\n,;]+/)
    .map((line) => line.replace(/^[\s\-*•\d.]+/, '').trim())
    .filter(Boolean);
}

/**
 * Interpreta a resposta do modelo e devolve uma lista de nomes de tag finais:
 * saneados, deduplicados por slug, limitados a MAX_TAGS. Reutiliza o nome exato
 * de uma tag existente quando o slug bate (evita quase-duplicatas de casing).
 */
export function resolveTagsDecision(raw: string, existingTags: string[]): string[] {
  const existingBySlug = new Map<string, string>();
  for (const name of existingTags) {
    const slug = slugifyTag(name);
    if (slug && !existingBySlug.has(slug)) existingBySlug.set(slug, name);
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const candidate of extractCandidates(raw)) {
    const cleaned = cleanTagName(candidate);
    if (!cleaned) continue;
    const slug = slugifyTag(cleaned);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    // Reutiliza casing da tag existente quando o slug coincide.
    out.push(existingBySlug.get(slug) ?? cleaned);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/**
 * Regra de folderId único (R-FOLDER, spec 075): mantém a pasta atual se já
 * houver; caso contrário adota a pasta candidata (da primeira tag). Pura.
 */
export function pickFolderId(current: string | null, candidate: string | null): string | null {
  return current ?? candidate;
}

function buildTagsPrompt(
  title: string,
  content: string,
  existingTags: string[],
  language: AppLanguage,
): { system: string; user: string } {
  const tagsBlock =
    existingTags.length > 0
      ? existingTags
          .slice(0, 120)
          .map((n) => `- ${n}`)
          .join('\n')
      : '(none yet)';
  const excerpt = content.replace(/\0/g, ' ').trim().slice(0, 4_000);

  if (language === 'en') {
    return {
      system:
        'You tag content for a personal knowledge base. Reply ONLY with a JSON ' +
        'array of 1-5 short tags (1-3 words each). Reuse an existing tag verbatim ' +
        'when it fits; only invent a new one when none applies. Never write a sentence.',
      user: `Title: ${title.trim() || '(no title)'}
Existing tags (reuse these when they fit):
${tagsBlock}

Return JSON only, e.g.: {"tags":["Anime","Review","Studio Ghibli"]}
Prefer 2-4 relevant tags. No duplicates. No sentences.

Content excerpt:
${excerpt}`,
    };
  }

  return {
    system:
      'Você cria tags para uma base de conhecimento pessoal. Responda APENAS com ' +
      'um array JSON de 1 a 5 tags curtas (1-3 palavras cada). Reutilize uma tag ' +
      'existente exatamente quando couber; só invente nova quando nenhuma servir. ' +
      'Nunca escreva frase.',
    user: `Título: ${title.trim() || '(sem título)'}
Tags existentes (reutilize quando couber):
${tagsBlock}

Responda só JSON, ex.: {"tags":["Anime","Review","Estúdio Ghibli"]}
Prefira 2-4 tags relevantes. Sem duplicatas. Sem frases.

Trecho do conteúdo:
${excerpt}`,
  };
}

export interface TagsGenerationResult {
  tags: string[];
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: string;
}

export function buildTagsRequestBody(
  model: string,
  system: string,
  user: string,
): Record<string, unknown> {
  return {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.2,
    max_tokens: 256,
    reasoning: { enabled: false },
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'content_tags',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            tags: {
              type: 'array',
              items: { type: 'string', minLength: 2, maxLength: 40 },
              minItems: 1,
              maxItems: MAX_TAGS,
            },
          },
          required: ['tags'],
          additionalProperties: false,
        },
      },
    },
    usage: { include: true },
  };
}

/**
 * Gera tags para um conteúdo via OpenRouter. Não persiste — quem chama decide
 * (criar/reutilizar Tag, garantir pasta, ligar TranscriptTag).
 */
export async function generateTagsForContent(input: {
  title: string;
  content: string;
  existingTags: string[];
  abortSignal?: AbortSignal;
}): Promise<TagsGenerationResult> {
  const settings = await getSettings(['openrouter_api_key', 'default_chat_model'] as const);
  const apiKey = settings.openrouter_api_key;
  const model = settings.default_chat_model;
  if (!apiKey || !model) {
    throw new Error('Setup incompleto — OpenRouter/modelo ausentes.');
  }
  const language = await getAppLanguage();
  const { system, user } = buildTagsPrompt(
    input.title,
    input.content,
    input.existingTags,
    language,
  );

  const res = await fetch(`${OR_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildTagsRequestBody(model, system, user)),
    signal: input.abortSignal
      ? AbortSignal.any([input.abortSignal, AbortSignal.timeout(60_000)])
      : AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(`OpenRouter retornou status ${res.status} ao gerar tags.`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number | string };
    model?: string;
  };
  const raw = (data.choices?.[0]?.message?.content ?? '').trim();
  const tags = resolveTagsDecision(raw, input.existingTags);
  return {
    tags,
    model: data.model ?? model,
    tokensIn: Number(data.usage?.prompt_tokens ?? 0) || 0,
    tokensOut: Number(data.usage?.completion_tokens ?? 0) || 0,
    costUsd: data.usage?.cost != null ? String(data.usage.cost) : '0',
  };
}
