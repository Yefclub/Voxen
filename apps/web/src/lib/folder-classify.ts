// ============================================================================
// Classificação de pasta via OpenRouter (espelho do worker).
// Usado no backfill "Organizar com IA" da biblioteca.
// ============================================================================

import { getAppLanguage, getSettings, type AppLanguage } from './settings';

const OR_BASE_URL = 'https://openrouter.ai/api/v1';

const FOLDER_META_PREFIXES = [
  'the content is about',
  'the content is a',
  'the content is an',
  'this content is about',
  'this is about',
  'this is a',
  'this is an',
  "it's about",
  'its about',
  'content about',
  'category:',
  'folder:',
  'pasta:',
  'label:',
  'topic:',
  'the topic is',
  'the subject is',
  'based on the content',
  'looking at the content',
] as const;

const FOLDER_BAD_MARKERS = [
  'the user',
  'i want',
  'i will',
  'i need',
  'i should',
  'let me',
  'categorize',
  'categorise',
  'classif',
  'organize',
  'organise',
  'please',
  'respond',
  'json',
  'folder name',
  'nome da pasta',
  'o conteúdo',
  'este conteúdo',
] as const;

export function resolveFolderDecision(raw: string, existingFolders: string[]): string | null {
  let text = (raw || '').trim();
  if (!text) return null;

  const fromJson = extractFolderFromJson(text);
  if (fromJson !== null) {
    text = fromJson;
  } else {
    for (const line of text.split(/\n/)) {
      const trimmed = line.trim().replace(/^`+|`+$/g, '');
      if (trimmed && !trimmed.startsWith('{') && !trimmed.startsWith('[')) {
        text = trimmed;
        break;
      }
    }
  }

  let cleaned = text
    .replace(/\n/g, ' ')
    .split(/\s+/)
    .join(' ')
    .trim()
    .replace(/^["'“”‘’#.*]+|["'“”‘’#.*]+$/g, '');
  if (!cleaned) return null;

  // Rejeita raciocínio/instrução do modelo ANTES de truncar ou strip de artigos.
  if (hasFolderMetaMarkers(cleaned)) return null;

  cleaned = stripFolderMetaPrefix(cleaned).replace(/^["'“”‘’#.*]+|["'“”‘’#.*]+$/g, '');
  if (!cleaned) return null;

  const token = cleaned.toUpperCase().trim();
  if (['NONE', 'NENHUMA', 'N/A', 'NA', 'NULL', 'UNDEFINED', 'NULO'].includes(token)) {
    return null;
  }

  for (const name of existingFolders) {
    if (name.toLocaleLowerCase('pt-BR') === cleaned.toLocaleLowerCase('pt-BR')) return name;
  }

  const cleanedTokens = new Set(
    cleaned
      .toLocaleLowerCase('pt-BR')
      .replace(/-/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3),
  );
  for (const name of existingFolders) {
    const nameTokens = new Set(
      name
        .toLocaleLowerCase('pt-BR')
        .replace(/-/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length >= 3),
    );
    if (
      cleanedTokens.size > 0 &&
      nameTokens.size > 0 &&
      cleanedTokens.size === nameTokens.size &&
      [...cleanedTokens].every((t) => nameTokens.has(t))
    ) {
      return name;
    }
  }

  let name = cleaned.replace(/^[ .:-]+|[ .:-]+$/g, '');
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length > 4) name = words.slice(0, 4).join(' ');
  if (name.length > 40) {
    name = name.slice(0, 40).replace(/\s+\S*$/, '') || name.slice(0, 40);
  }
  name = name.replace(/^[ .:"'“”‘’-]+|[ .:"'“”‘’-]+$/g, '').trim();
  if (name.length < 2) return null;
  if (isBadFolderLabel(name)) return null;
  return name;
}

function extractFolderFromJson(raw: string): string | null {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
  if (fence?.[1]) text = fence[1];
  else {
    const brace = text.match(/\{[^{}]*\}/);
    if (brace) text = brace[0];
  }
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    for (const key of ['folder', 'name', 'label', 'pasta', 'category']) {
      if (!(key in data)) continue;
      const val = data[key];
      if (val === null) return 'NONE';
      if (typeof val === 'string') return val.trim();
    }
  } catch {
    return null;
  }
  return null;
}

function stripFolderMetaPrefix(value: string): string {
  let rest = value;
  const lower = rest.toLocaleLowerCase('en-US');
  let matched = false;
  for (const prefix of FOLDER_META_PREFIXES) {
    if (lower.startsWith(prefix)) {
      rest = rest
        .slice(prefix.length)
        .replace(/^[ :,"'“”‘’\u2013\u2014-]+/, '')
        .trim();
      matched = true;
      break;
    }
  }
  // truncamento do modelo: "HyperDX, an" / "Observe, a"
  rest = rest.replace(/,\s*(a|an|the|um|uma)\s*$/i, '').trim();
  // artigo / filler só após meta: "an Elden Ring game" → "Elden Ring game"
  if (matched) {
    rest = rest.replace(/^(a|an|the|um|uma|using|about)\s+/i, '').trim();
  }
  return rest.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
}

function hasFolderMetaMarkers(value: string): boolean {
  const lower = value.toLocaleLowerCase('en-US');
  for (const marker of FOLDER_BAD_MARKERS) {
    if (lower.includes(marker)) return true;
  }
  // "The content is about X" ainda pode ser recuperável via strip.
  if (FOLDER_META_PREFIXES.some((p) => lower.startsWith(p))) return false;
  const words = lower.split(/\s+/).filter(Boolean);
  if (words.length > 6) return true;
  if (
    words[0] &&
    ['the', 'this', 'that', 'i', 'we', 'you'].includes(words[0]) &&
    words.length > 3
  ) {
    return true;
  }
  return false;
}

function isBadFolderLabel(name: string): boolean {
  const lower = name.toLocaleLowerCase('en-US');
  const words = lower.split(/\s+/).filter(Boolean);
  if (words.length > 4) return true;
  if (
    /( a| an| the| of| for| to| and| or| called| about| with| from| is| are| uma| um| de| da| do)$/.test(
      ` ${lower}`,
    )
  ) {
    return true;
  }
  if (
    words[0] &&
    [
      'the',
      'this',
      'that',
      'these',
      'those',
      'a',
      'an',
      'i',
      'we',
      'you',
      'my',
      'our',
      'user',
    ].includes(words[0])
  ) {
    return true;
  }
  if (
    [
      'content',
      'conteúdo',
      'misc',
      'other',
      'geral',
      'various',
      'stuff',
      'open-source',
      'open source',
      'library',
      'tool',
      'checklist',
      'game',
      'shift',
    ].includes(lower)
  ) {
    return true;
  }
  return false;
}

function buildClassifyPrompt(
  title: string,
  content: string,
  existingFolders: string[],
  language: AppLanguage,
): { system: string; user: string } {
  const foldersBlock =
    existingFolders.length > 0
      ? existingFolders
          .slice(0, 80)
          .map((n) => `- ${n}`)
          .join('\n')
      : '(none yet)';
  const excerpt = content.replace(/\0/g, ' ').trim().slice(0, 4_000);

  if (language === 'en') {
    return {
      system:
        "You label personal knowledge-base folders. Reply with ONE short folder label only (1-4 words), or null. Never write a sentence. Never start with 'The content is about'.",
      user: `Title: ${title.trim() || '(no title)'}
Existing folders:
${foldersBlock}

Return JSON only: {"folder":"Short Label"} or {"folder":null}
GOOD: HyperDX, Elden Ring, Alibaba Cloud, TypeScript, Web Security, Claude Code
BAD: The content is about..., The user wants..., A tool called..., incomplete phrases
Reuse an existing folder name when it fits.

Content excerpt:
${excerpt}`,
    };
  }

  return {
    system:
      "Você nomeia pastas de uma base de conhecimento pessoal. Responda só com um rótulo curto (1-4 palavras) ou null. Nunca escreva frase. Nunca comece com 'The content is about'.",
    user: `Título: ${title.trim() || '(sem título)'}
Pastas existentes:
${foldersBlock}

Responda APENAS JSON: {"folder":"Rótulo Curto"} ou {"folder":null}
BONS: HyperDX, Elden Ring, Alibaba Cloud, TypeScript, Segurança Web, Claude Code
RUINS: The content is about..., The user wants..., frases incompletas, raciocínio
Reutilize pasta existente quando couber. Prefira o nome do produto/tema.

Trecho do conteúdo:
${excerpt}`,
  };
}

export async function classifyFolderForContent(input: {
  title: string;
  content: string;
  existingFolders: string[];
}): Promise<{
  folderName: string | null;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: string;
}> {
  const settings = await getSettings(['openrouter_api_key', 'default_chat_model'] as const);
  const apiKey = settings.openrouter_api_key;
  const model = settings.default_chat_model;
  if (!apiKey || !model) {
    throw new Error('Setup incompleto — OpenRouter/modelo ausentes.');
  }
  const language = await getAppLanguage();
  const { system, user } = buildClassifyPrompt(
    input.title,
    input.content,
    input.existingFolders,
    language,
  );

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
      temperature: 0,
      max_tokens: 48,
      usage: { include: true },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(`OpenRouter retornou status ${res.status} ao classificar o conteúdo.`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number | string };
    model?: string;
  };
  const raw = (data.choices?.[0]?.message?.content ?? '').trim();
  const folderName = resolveFolderDecision(raw, input.existingFolders);
  return {
    folderName,
    model: data.model ?? model,
    tokensIn: Number(data.usage?.prompt_tokens ?? 0) || 0,
    tokensOut: Number(data.usage?.completion_tokens ?? 0) || 0,
    costUsd: data.usage?.cost != null ? String(data.usage.cost) : '0',
  };
}
