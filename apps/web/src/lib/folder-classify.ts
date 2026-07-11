// ============================================================================
// Classificação de pasta via OpenRouter (espelho do worker).
// Usado no backfill "Organizar com IA" da biblioteca.
// ============================================================================

import { getAppLanguage, getSetting, type AppLanguage } from './settings';

const OR_BASE_URL = 'https://openrouter.ai/api/v1';

export function resolveFolderDecision(
  raw: string,
  existingFolders: string[],
): string | null {
  const cleaned = raw.replace(/\n/g, ' ').split(/\s+/).join(' ').trim().replace(/^["'“”‘’#]+|["'“”‘’#]+$/g, '');
  if (!cleaned) return null;
  const token = cleaned.toUpperCase();
  if (['NONE', 'NENHUMA', 'N/A', 'NA', 'NULL'].includes(token)) return null;
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
  if (name.length > 40) {
    name = name.slice(0, 40).replace(/\s+\S*$/, '') || name.slice(0, 40);
  }
  name = name.trim();
  if (name.length < 2) return null;
  return name;
}

function buildClassifyPrompt(
  title: string,
  content: string,
  existingFolders: string[],
  language: AppLanguage,
): string {
  const foldersBlock =
    existingFolders.length > 0
      ? existingFolders
          .slice(0, 80)
          .map((n) => `- ${n}`)
          .join('\n')
      : language === 'en'
        ? '(no folders yet)'
        : '(nenhuma pasta ainda)';
  const excerpt = content.replace(/\0/g, ' ').trim().slice(0, 6_000);

  if (language === 'en') {
    return `Title: ${title.trim() || '(no title)'}

Existing user folders:
${foldersBlock}

Choose ONE library folder (filter/tab) for this content.
Rules:
1. If an existing folder fits well, reply with its exact name.
2. If none fit, invent a short English name (1–3 words, max 40 chars).
   Examples: Anime, Productivity, Brazilian History, Machine Learning.
3. If classification is unsafe, reply: NONE
4. No quotes. No explanation. Only the name or NONE.

Content:
${excerpt}`;
  }

  return `Título: ${title.trim() || '(sem título)'}

Pastas existentes do usuário:
${foldersBlock}

Escolha UMA pasta de biblioteca (filtro/aba) para este conteúdo.
Regras:
1. Se alguma pasta existente servir bem, responda exatamente com o nome dela.
2. Se nenhuma servir, invente um nome curto em português do Brasil
   (1–3 palavras, máximo 40 caracteres, Title Case quando fizer sentido).
   Exemplos: Anime, Produtividade, História do Brasil, Machine Learning.
3. Se o conteúdo for impossível de classificar com segurança, responda: NONE
4. Não use aspas. Não explique. Responda só o nome ou NONE.

Conteúdo:
${excerpt}`;
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
  const apiKey = await getSetting('openrouter_api_key');
  const model = await getSetting('default_chat_model');
  if (!apiKey || !model) {
    throw new Error('Setup incompleto — OpenRouter/modelo ausentes.');
  }
  const language = await getAppLanguage();
  const prompt = buildClassifyPrompt(
    input.title,
    input.content,
    input.existingFolders,
    language,
  );
  const system =
    language === 'en'
      ? 'You organize a personal knowledge base into thematic folders. Reply only with the folder name or NONE.'
      : 'Você organiza uma base de conhecimento pessoal em pastas temáticas. Responda apenas com o nome da pasta ou NONE.';

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
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 24,
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
  const folderName = resolveFolderDecision(raw, input.existingFolders);
  return {
    folderName,
    model: data.model ?? model,
    tokensIn: Number(data.usage?.prompt_tokens ?? 0) || 0,
    tokensOut: Number(data.usage?.completion_tokens ?? 0) || 0,
    costUsd: data.usage?.cost != null ? String(data.usage.cost) : '0',
  };
}
