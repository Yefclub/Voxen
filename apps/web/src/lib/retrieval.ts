// ============================================================================
// retrieval.ts — Harness de recuperação progressiva (sem embeddings)
// ============================================================================
// Lógica compartilhada entre o agente in-app (lib/chat/runtime.ts) e o servidor
// MCP (routes/mcp.ts). A ideia (ADR-004, harness/Karpathy) é dar ao agente
// ferramentas determinísticas de leitura progressiva sobre o acervo em vez de
// RAG vetorial:
//   buscar (FTS) -> ver estrutura (outline) -> ler trechos (linhas/seção/tempo)
//   -> expandir contexto -> relacionar -> validar citações.
//
// As funções de PARSING são PURAS: recebem o texto do `.md` como argumento e não
// tocam DB/S3 — testáveis isoladamente. As funções de acesso (loadTranscriptMd,
// ftsSearchTranscripts, findRelated) escopam TUDO por userId (isolamento de
// workspace) e são read-only.
//
// Fonte de estrutura/timestamps: o `.md` canônico no S3/MinIO (Transcript.mdPath).
// O `Transcript.plainText` do Postgres é só texto corrido pra FTS — NÃO tem
// timestamps nem headings, então nunca é usado como fonte de estrutura.
// Formato do `.md`: docs/TRANSCRIPT-FORMAT.md.
// ============================================================================

import { GetObjectCommand } from '@aws-sdk/client-s3';
import { db } from './db';
import { s3Bucket, s3Client } from './s3';

// Caps de saída — nenhuma tool devolve o documento inteiro sem intenção explícita.
export const MAX_READ_LINES = 200;
export const MAX_OUTLINE_SECTIONS = 300;
export const MAX_FOUND_TEXT_CHARS = 1200;
export const DEFAULT_EXPAND_RADIUS = 8;

// Timestamp de linha: `[hh:mm:ss]` no começo da linha (sempre 8 chars com zeros
// à esquerda, ver TRANSCRIPT-FORMAT.md). Aceita 1–2 dígitos na hora por robustez.
const LINE_TS_RE = /^\s*\[(\d{1,2}):([0-5]?\d):([0-5]?\d)\]/;
const HEADING_RE = /^(#{1,6})\s+(.*\S)\s*$/;

export type NumberedLine = { n: number; text: string };

export type OutlineSection = {
  index: number;
  heading: string;
  level: number;
  startLine: number;
  lineCount: number;
  startSec: number | null;
  startTs: string | null;
};

export type Outline = {
  totalLines: number;
  sections: OutlineSection[];
};

export type Claim = {
  transcriptId: string;
  quote: string;
  fromLine?: number;
  toLine?: number;
  fromSec?: number;
  toSec?: number;
};

export type ClaimVerdict = {
  supported: boolean;
  foundText: string;
  region: { from: number; to: number } | null;
};

// ----------------------------------------------------------------------------
// Helpers puros
// ----------------------------------------------------------------------------

/** Segundos de uma linha timestamped, ou null se a linha não começa com `[hh:mm:ss]`. */
export function parseLineTimestamp(line: string | undefined): number | null {
  if (line === undefined) return null;
  const m = LINE_TS_RE.exec(line);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const s = Number(m[3]);
  return h * 3600 + min * 60 + s;
}

/** Segundos -> `hh:mm:ss` (8 chars, zero-padded). */
export function secondsToHms(totalSec: number): string {
  const sec = Math.max(0, Math.trunc(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/**
 * Normaliza texto para comparação determinística de citações: remove acentos,
 * minúsculas e colapsa qualquer sequência não-alfanumérica (pontuação, markdown,
 * timestamps, quebras) em um único espaço. Assim o `quote` casa mesmo que a linha
 * do `.md` carregue o prefixo `[hh:mm:ss](url) `.
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function splitLines(md: string): string[] {
  return md.split('\n');
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(Math.trunc(n), max));
}

// ----------------------------------------------------------------------------
// Parsing puro do `.md`
// ----------------------------------------------------------------------------

/**
 * Estrutura compacta do `.md`: seções (headings `#`..`######`) com a linha
 * inicial, quantidade de linhas e o primeiro timestamp encontrado na seção.
 * Sem conteúdo pesado — serve pra decidir QUAL trecho abrir depois.
 */
export function parseOutline(md: string): Outline {
  const lines = splitLines(md);
  const totalLines = lines.length;
  const headings: { line: number; level: number; heading: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw === undefined) continue;
    const m = HEADING_RE.exec(raw);
    if (m) headings.push({ line: i + 1, level: (m[1] ?? '').length, heading: m[2] ?? '' });
  }
  const sections: OutlineSection[] = [];
  for (let idx = 0; idx < headings.length; idx++) {
    const current = headings[idx];
    if (!current) continue;
    const next = headings[idx + 1];
    const startLine = current.line;
    const endLine = next ? next.line - 1 : totalLines;
    let startSec: number | null = null;
    for (let ln = startLine; ln <= endLine; ln++) {
      const sec = parseLineTimestamp(lines[ln - 1]);
      if (sec !== null) {
        startSec = sec;
        break;
      }
    }
    sections.push({
      index: idx,
      heading: current.heading,
      level: current.level,
      startLine,
      lineCount: endLine - startLine + 1,
      startSec,
      startTs: startSec === null ? null : secondsToHms(startSec),
    });
    if (sections.length >= MAX_OUTLINE_SECTIONS) break;
  }
  return { totalLines, sections };
}

/**
 * Lê um intervalo de linhas [from, to] (1-indexed, inclusivo), com cap de
 * MAX_READ_LINES. `truncated` indica que o intervalo pedido foi cortado pelo cap.
 */
export function readLinesFromMd(
  md: string,
  from: number,
  to: number,
): { totalLines: number; from: number; to: number; truncated: boolean; lines: NumberedLine[] } {
  const all = splitLines(md);
  const totalLines = all.length;
  const start = clampInt(from, 1, 1, Math.max(1, totalLines));
  let end = clampInt(to, start, start, Math.max(start, totalLines));
  const requestedEnd = end;
  if (end - start + 1 > MAX_READ_LINES) end = start + MAX_READ_LINES - 1;
  const lines: NumberedLine[] = [];
  for (let n = start; n <= end && n <= totalLines; n++) lines.push({ n, text: all[n - 1] ?? '' });
  return {
    totalLines,
    from: start,
    to: Math.min(end, totalLines),
    truncated: end < requestedEnd,
    lines,
  };
}

/**
 * Lê a seção do outline por `heading` (case-insensitive, match parcial) OU por
 * `index` (posição no outline). Retorna as linhas daquela seção (com cap).
 */
export function readSectionFromMd(
  md: string,
  ref: { heading?: string; index?: number },
): { section: OutlineSection; truncated: boolean; lines: NumberedLine[] } | null {
  const { sections } = parseOutline(md);
  if (sections.length === 0) return null;
  let section: OutlineSection | undefined;
  if (typeof ref.index === 'number') {
    section = sections[ref.index];
  } else if (ref.heading) {
    const needle = ref.heading.trim().toLowerCase();
    section =
      sections.find((s) => s.heading.toLowerCase() === needle) ??
      sections.find((s) => s.heading.toLowerCase().includes(needle));
  }
  if (!section) return null;
  const read = readLinesFromMd(md, section.startLine, section.startLine + section.lineCount - 1);
  return { section, truncated: read.truncated, lines: read.lines };
}

/**
 * Lê as linhas cujo timestamp `[hh:mm:ss]` cai em [fromSec, toSec] (inclusivo).
 * Determinístico e com cap de MAX_READ_LINES.
 */
export function readTimespanFromMd(
  md: string,
  fromSec: number,
  toSec: number,
): { fromSec: number; toSec: number; truncated: boolean; lines: NumberedLine[] } {
  const all = splitLines(md);
  const lo = Math.max(0, Math.min(fromSec, toSec));
  const hi = Math.max(fromSec, toSec);
  const lines: NumberedLine[] = [];
  let truncated = false;
  for (let i = 0; i < all.length; i++) {
    const sec = parseLineTimestamp(all[i]);
    if (sec === null || sec < lo || sec > hi) continue;
    if (lines.length >= MAX_READ_LINES) {
      truncated = true;
      break;
    }
    lines.push({ n: i + 1, text: all[i] ?? '' });
  }
  return { fromSec: lo, toSec: hi, truncated, lines };
}

/**
 * Encontra a linha-âncora (por número de linha OU por timestamp) e devolve uma
 * janela de `radius` linhas antes/depois. Por timestamp, a âncora é a última
 * linha timestamped com sec <= anchor.sec (a que "cobre" o instante).
 */
export function expandContextFromMd(
  md: string,
  anchor: { line?: number; sec?: number },
  radius: number = DEFAULT_EXPAND_RADIUS,
): { anchorLine: number; from: number; to: number; lines: NumberedLine[] } | null {
  const all = splitLines(md);
  const totalLines = all.length;
  if (totalLines === 0) return null;
  const r = clampInt(radius, DEFAULT_EXPAND_RADIUS, 0, MAX_READ_LINES);
  let anchorLine: number | null = null;
  if (typeof anchor.line === 'number') {
    anchorLine = clampInt(anchor.line, 1, 1, totalLines);
  } else if (typeof anchor.sec === 'number') {
    for (let i = 0; i < all.length; i++) {
      const sec = parseLineTimestamp(all[i]);
      if (sec !== null && sec <= anchor.sec) anchorLine = i + 1;
      if (sec !== null && sec > anchor.sec) break;
    }
    // Antes do primeiro timestamp: ancora na primeira linha timestamped, se houver.
    if (anchorLine === null) {
      for (let i = 0; i < all.length; i++) {
        if (parseLineTimestamp(all[i]) !== null) {
          anchorLine = i + 1;
          break;
        }
      }
    }
  }
  if (anchorLine === null) return null;
  const read = readLinesFromMd(md, anchorLine - r, anchorLine + r);
  return { anchorLine, from: read.from, to: read.to, lines: read.lines };
}

/**
 * Verifica DETERMINISTICAMENTE (sem LLM) se `quote` aparece no trecho indicado do
 * `.md`. A região é definida por linhas (fromLine/toLine), por tempo
 * (fromSec/toSec) ou, na ausência de ambos, o documento inteiro. Comparação
 * normalizada (sem acentos, minúsculas, espaços colapsados).
 */
export function verifyClaimAgainstMd(md: string, claim: Omit<Claim, 'transcriptId'>): ClaimVerdict {
  let regionText = md;
  let region: { from: number; to: number } | null = null;
  if (typeof claim.fromLine === 'number' || typeof claim.toLine === 'number') {
    const all = splitLines(md);
    const from = clampInt(claim.fromLine, 1, 1, Math.max(1, all.length));
    const to = clampInt(claim.toLine, from, from, Math.max(from, all.length));
    const read = readLinesFromMd(md, from, to);
    regionText = read.lines.map((l) => l.text).join('\n');
    region = { from: read.from, to: read.to };
  } else if (typeof claim.fromSec === 'number' || typeof claim.toSec === 'number') {
    const read = readTimespanFromMd(md, claim.fromSec ?? 0, claim.toSec ?? claim.fromSec ?? 0);
    regionText = read.lines.map((l) => l.text).join('\n');
    const first = read.lines[0];
    const last = read.lines[read.lines.length - 1];
    if (first && last) {
      region = { from: first.n, to: last.n };
    }
  }
  const normalizedQuote = normalizeForMatch(claim.quote);
  const supported =
    normalizedQuote.length > 0 && normalizeForMatch(regionText).includes(normalizedQuote);
  return {
    supported,
    foundText: regionText.slice(0, MAX_FOUND_TEXT_CHARS),
    region,
  };
}

// ----------------------------------------------------------------------------
// Acesso a dados (escopado por userId) — read-only
// ----------------------------------------------------------------------------

/**
 * Carrega o `.md` canônico de uma transcrição do usuário (status ACTIVE) a partir
 * do S3/MinIO (Transcript.mdPath), com fallback pro plainText do Postgres em caso
 * de erro de storage. Retorna null se a transcrição não existe/não é do user.
 */
export async function loadTranscriptMd(
  userId: string,
  transcriptId: string,
): Promise<{ id: string; title: string; url: string; md: string } | null> {
  const t = await db.transcript.findFirst({
    where: { id: transcriptId, userId, status: 'ACTIVE' },
    select: { id: true, title: true, url: true, mdPath: true, plainText: true },
  });
  if (!t) return null;
  let md: string;
  try {
    const res = await s3Client().send(new GetObjectCommand({ Bucket: s3Bucket(), Key: t.mdPath }));
    md = (await res.Body?.transformToString('utf-8')) ?? '';
    if (!md) md = `# ${t.title}\n\n${t.plainText}`;
  } catch {
    md = `# ${t.title}\n\n${t.plainText}`;
  }
  return { id: t.id, title: t.title, url: t.url, md };
}

export type FtsResult = {
  id: string;
  title: string;
  snippet: string;
  rank: number;
  summary: string | null;
  tags: string[];
  folder: string | null;
  createdAt: Date;
};

const PROMPT_STOP_WORDS = new Set([
  'para',
  'com',
  'uma',
  'que',
  'como',
  'por',
  'dos',
  'das',
  'isso',
  'esta',
  'esse',
  'sobre',
  'the',
  'and',
  'from',
  'this',
  'that',
  'what',
]);

/** Converte um prompt livre numa consulta OR curta e segura para websearch_to_tsquery. */
export function promptSearchQuery(prompt: string): string {
  const words = prompt
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .match(/[a-z0-9]{3,}/g);
  if (!words) return '';
  const unique = [...new Set(words.filter((word) => !PROMPT_STOP_WORDS.has(word)))].slice(0, 8);
  return unique.join(' OR ');
}

/**
 * Busca full-text forte nas transcrições do usuário (Postgres FTS, dicionário
 * português): ts_headline (trecho destacado) + ts_rank (relevância). Retorna
 * trechos curtos, NUNCA o texto completo. Espelha voxen_search_transcripts.
 */
export async function ftsSearchTranscripts(
  userId: string,
  query: string,
  limit: number,
): Promise<FtsResult[]> {
  const q = query.trim();
  if (!q) return [];
  const take = clampInt(limit, 8, 1, 25);
  const lexical = await db.$queryRaw<FtsResult[]>`
    SELECT t.id, t.title,
      ts_headline('portuguese', t."plainText", websearch_to_tsquery('portuguese', ${q}),
        'StartSel=«, StopSel=», MaxWords=22, MinWords=8, MaxFragments=1') AS snippet,
      ts_rank(t."searchVector", websearch_to_tsquery('portuguese', ${q})) AS rank,
      LEFT(t."summaryMd", 800) AS summary,
      folder.name AS folder,
      t."createdAt",
      COALESCE((
        SELECT array_agg(tag.name ORDER BY tag.name)
        FROM "TranscriptTag" tt
        JOIN "Tag" tag ON tag.id = tt."tagId" AND tag."userId" = t."userId"
        WHERE tt."transcriptId" = t.id
      ), ARRAY[]::text[]) AS tags
    FROM "Transcript" t
    LEFT JOIN "LibraryFolder" folder ON folder.id = t."folderId" AND folder."userId" = t."userId"
    WHERE t."userId" = ${userId}
      AND t.status = 'ACTIVE'::"ContentStatus"
      AND t."searchVector" @@ websearch_to_tsquery('portuguese', ${q})
    ORDER BY rank DESC, t."createdAt" DESC
    LIMIT ${take}
  `;
  return maybeHybridRerank(userId, q, lexical);
}

async function maybeHybridRerank(
  userId: string,
  query: string,
  lexical: FtsResult[],
): Promise<FtsResult[]> {
  if (lexical.length < 2) return lexical;
  try {
    const { getSetting } = await import('./settings');
    const enabled = (await getSetting('embeddings_enabled'))?.trim().toLowerCase();
    if (enabled !== 'true' && enabled !== '1' && enabled !== 'yes' && enabled !== 'on') {
      return lexical;
    }
    const { cosineSimilarity, fuseHybridScores, readEmbeddingFromMetadata } =
      await import('./hybrid-search');
    const nodes = await db.brainNode.findMany({
      where: {
        userId,
        status: 'ACTIVE',
        sourceType: 'TRANSCRIPT',
        sourceId: { in: lexical.map((item) => item.id) },
      },
      select: { sourceId: true, metadata: true },
    });
    const byTranscript = new Map(
      nodes
        .map((node) => [node.sourceId, readEmbeddingFromMetadata(node.metadata)] as const)
        .filter((entry): entry is [string, number[]] => Boolean(entry[0] && entry[1])),
    );
    if (byTranscript.size === 0) return lexical;

    // Query embedding: se não houver, cai no lexical puro (sem chamada de rede no path de chat
    // a menos que o operador habilite embeddings e exista cache futuro).
    // Aqui só reordena com vetores já persistidos + similaridade entre hits via centroide FTS.
    // Similaridade ao query exigiria embed da query no request — fazemos com o top lexical
    // como âncora (MMR-lite): score = lex + cos(top0, item).
    const topVec = byTranscript.get(lexical[0]?.id ?? '');
    if (!topVec) return lexical;
    const fused = fuseHybridScores(
      lexical.map((item) => {
        const vec = byTranscript.get(item.id);
        return {
          id: item.id,
          lexicalScore: Number(item.rank) || 0,
          vectorScore: vec ? cosineSimilarity(topVec, vec) : null,
        };
      }),
      { alpha: 0.3 },
    );
    const byId = new Map(lexical.map((item) => [item.id, item]));
    return fused.map((hit) => byId.get(hit.id)).filter((item): item is FtsResult => Boolean(item));
  } catch {
    return lexical;
  }
}

/** Pré-busca best-effort usada pelo harness antes do primeiro step do modelo. */
export async function preloadRelevantContent(
  userId: string,
  prompt: string,
  limit = 5,
): Promise<FtsResult[]> {
  const query = promptSearchQuery(prompt);
  if (!query) return [];
  return ftsSearchTranscripts(userId, query, limit);
}

export type RelatedItem = {
  id: string;
  title: string;
  kind: 'transcript' | 'note' | 'brain';
  reason: string;
};

/**
 * Documentos/entidades relacionados, sem embeddings. Combina:
 *  - Vizinhança no Brain (brainNode.sourceId == transcriptId -> brainEdge ->
 *    nós conectados -> resolvidos a transcrições/notas por sourceId);
 *  - FTS por título (quando há transcriptId) ou pela query informada.
 * Escopado por userId. Não inclui a própria transcrição de origem.
 */
export async function findRelated(
  userId: string,
  input: { transcriptId?: string; query?: string; limit?: number },
): Promise<RelatedItem[]> {
  const limit = clampInt(input.limit, 10, 1, 25);
  const seen = new Set<string>();
  const out: RelatedItem[] = [];
  const push = (item: RelatedItem) => {
    if (item.id === input.transcriptId || seen.has(`${item.kind}:${item.id}`)) return;
    seen.add(`${item.kind}:${item.id}`);
    out.push(item);
  };

  // Termo de FTS: a query explícita, ou o título da transcrição de origem.
  let ftsTerm = input.query?.trim() ?? '';
  if (!ftsTerm && input.transcriptId) {
    const origin = await db.transcript.findFirst({
      where: { id: input.transcriptId, userId, status: 'ACTIVE' },
      select: { title: true },
    });
    ftsTerm = origin?.title?.trim() ?? '';
  }

  // 1) Vizinhança no Brain a partir da transcrição de origem.
  if (input.transcriptId) {
    const originTags = await db.transcriptTag.findMany({
      where: { transcriptId: input.transcriptId, transcript: { userId, status: 'ACTIVE' } },
      select: { tagId: true, tag: { select: { name: true } } },
    });
    if (originTags.length > 0) {
      const tagIds = originTags.map((item) => item.tagId);
      const tagNames = new Map(originTags.map((item) => [item.tagId, item.tag.name]));
      const shared = await db.transcript.findMany({
        where: {
          userId,
          status: 'ACTIVE',
          id: { not: input.transcriptId },
          tags: { some: { tagId: { in: tagIds } } },
        },
        select: {
          id: true,
          title: true,
          tags: { where: { tagId: { in: tagIds } }, select: { tagId: true } },
        },
        take: limit,
      });
      for (const item of shared) {
        const names = item.tags
          .map((tag) => tagNames.get(tag.tagId))
          .filter((name): name is string => Boolean(name));
        push({
          id: item.id,
          title: item.title,
          kind: 'transcript',
          reason: `Tags em comum: ${names.join(', ')}`,
        });
      }
    }

    const originNodes = await db.brainNode.findMany({
      where: { userId, status: 'ACTIVE', sourceType: 'TRANSCRIPT', sourceId: input.transcriptId },
      select: { id: true },
      take: 20,
    });
    const originIds = originNodes.map((n) => n.id);
    if (originIds.length > 0) {
      const edges = await db.brainEdge.findMany({
        where: {
          userId,
          status: 'ACTIVE',
          OR: [{ fromNodeId: { in: originIds } }, { toNodeId: { in: originIds } }],
        },
        take: 60,
        select: {
          fromNodeId: true,
          toNodeId: true,
          kind: true,
          from: { select: { id: true, label: true, sourceType: true, sourceId: true } },
          to: { select: { id: true, label: true, sourceType: true, sourceId: true } },
        },
      });
      const originSet = new Set(originIds);
      for (const e of edges) {
        const neighbor = originSet.has(e.fromNodeId) ? e.to : e.from;
        if (!neighbor.sourceId) continue;
        if (neighbor.sourceType === 'TRANSCRIPT') {
          push({
            id: neighbor.sourceId,
            title: neighbor.label,
            kind: 'transcript',
            reason: `Conectado no Brain (${e.kind})`,
          });
        } else if (neighbor.sourceType === 'NOTE') {
          push({
            id: neighbor.sourceId,
            title: neighbor.label,
            kind: 'note',
            reason: `Conectado no Brain (${e.kind})`,
          });
        }
      }
    }
  }

  // 2) FTS por título/tópico.
  if (ftsTerm) {
    const hits = await ftsSearchTranscripts(userId, ftsTerm, Math.min(limit, 10));
    for (const h of hits) {
      push({ id: h.id, title: h.title, kind: 'transcript', reason: 'Relevância textual (FTS)' });
    }
  }

  return out.slice(0, limit);
}
