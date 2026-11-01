import { z } from 'zod';
import { type McpServer } from '@modelcontextprotocol/server';
import {
  expandContextFromMd,
  findEnclosingSection,
  findRelatedPage,
  loadTranscriptMd,
  parseOutline,
  readLinesFromMd,
  readSectionFromMd,
  readTimespanFromMd,
  verifyClaimAgainstMd,
} from '../lib/retrieval';
import { TranscriptReadError } from '../lib/transcript-content';
import { fail, ok, READ_ONLY } from './mcp-tool-helpers';

const REVISION_FILTERS = {
  correction_revision: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Revisão de correção esperada; diverge → erro STALE_REVISION.'),
  source_version: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Versão da fonte esperada; diverge → erro STALE_REVISION.'),
} as const;

function readError(error: unknown): { error: string; code?: string; current?: unknown } | null {
  if (error instanceof TranscriptReadError) {
    const suffix =
      error.code === 'STALE_REVISION' && error.current
        ? ` (atual: correction_revision=${error.current.correctionRevision}, source_version=${error.current.sourceVersion})`
        : '';
    return {
      error:
        (error.code === 'NOT_FOUND'
          ? 'Transcrição não encontrada (ou fora do escopo do token).'
          : error.code === 'STALE_REVISION'
            ? 'Revisão desatualizada: releia outline/trechos.'
            : 'Fonte canônica indisponível no storage.') + suffix,
      code: error.code,
      ...(error.current ? { current: error.current } : {}),
    };
  }
  return null;
}

async function loadDoc(
  userId: string,
  transcriptId: string,
  args: { correction_revision?: number; source_version?: number },
) {
  return loadTranscriptMd(userId, transcriptId.trim(), {
    expectedCorrectionRevision: args.correction_revision,
    expectedSourceVersion: args.source_version,
  });
}

export function registerProgressiveTools(server: McpServer, userId: string): void {
  server.registerTool(
    'voxen_outline',
    {
      title: 'Estrutura da transcrição',
      description:
        'PASSO 2 do fluxo: lista a ESTRUTURA do `.md` de uma transcrição — seções (headings) ' +
        'com heading, timestamp inicial (hh:mm:ss + seg), linha inicial e nº de linhas, mais o ' +
        'total de linhas. Use após buscar e antes de abrir conteúdo, para mirar o trecho certo. ' +
        'Sem texto pesado. `truncated=true` indica mais seções que o limite (300).',
      inputSchema: {
        transcript_id: z.string().min(1).describe('ID da transcrição.'),
        ...REVISION_FILTERS,
      },
      annotations: { ...READ_ONLY, title: 'Estrutura da transcrição' },
    },
    async (args) => {
      let doc: Awaited<ReturnType<typeof loadDoc>>;
      try {
        doc = await loadDoc(userId, args.transcript_id, args);
      } catch (error) {
        const mapped = readError(error);
        if (mapped) return fail(`${mapped.code}: ${mapped.error}`);
        throw error;
      }
      const outline = parseOutline(doc.md);
      return ok({
        id: doc.id,
        title: doc.title,
        correctionRevision: doc.correctionRevision,
        sourceVersion: doc.sourceVersion,
        ...outline,
      });
    },
  );

  server.registerTool(
    'voxen_read_lines',
    {
      title: 'Ler linhas',
      description:
        'PASSO 3: lê um intervalo de linhas [from, to] (1-indexed, inclusivo, cap de 200 linhas) ' +
        'do `.md`. Prefira isto a ler o documento inteiro. A resposta inclui a seção ' +
        'que contém o trecho (índice navegável em voxen_read_section).',
      inputSchema: {
        transcript_id: z.string().min(1).describe('ID da transcrição.'),
        from: z.number().int().min(1).describe('Primeira linha (1-indexed).'),
        to: z.number().int().min(1).describe('Última linha (inclusiva).'),
        ...REVISION_FILTERS,
      },
      annotations: { ...READ_ONLY, title: 'Ler linhas' },
    },
    async (args) => {
      let doc: Awaited<ReturnType<typeof loadDoc>>;
      try {
        doc = await loadDoc(userId, args.transcript_id, args);
      } catch (error) {
        const mapped = readError(error);
        if (mapped) return fail(`${mapped.code}: ${mapped.error}`);
        throw error;
      }
      const lines = readLinesFromMd(doc.md, args.from, args.to);
      return ok({
        id: doc.id,
        title: doc.title,
        correctionRevision: doc.correctionRevision,
        sourceVersion: doc.sourceVersion,
        ...lines,
        section: findEnclosingSection(doc.md, lines.from),
      });
    },
  );

  server.registerTool(
    'voxen_read_section',
    {
      title: 'Ler seção',
      description:
        'PASSO 3: lê as linhas de uma seção do outline, por `heading` (match parcial, ' +
        'case-insensitive) OU por `index` (posição no outline de voxen_outline).',
      inputSchema: {
        transcript_id: z.string().min(1).describe('ID da transcrição.'),
        heading: z.string().min(1).optional().describe('Heading da seção (match parcial).'),
        index: z.number().int().min(0).optional().describe('Índice da seção no outline.'),
        ...REVISION_FILTERS,
      },
      annotations: { ...READ_ONLY, title: 'Ler seção' },
    },
    async (args) => {
      if (args.heading === undefined && args.index === undefined) {
        return fail('Informe heading ou index.');
      }
      let doc: Awaited<ReturnType<typeof loadDoc>>;
      try {
        doc = await loadDoc(userId, args.transcript_id, args);
      } catch (error) {
        const mapped = readError(error);
        if (mapped) return fail(`${mapped.code}: ${mapped.error}`);
        throw error;
      }
      const result = readSectionFromMd(doc.md, { heading: args.heading, index: args.index });
      if (!result) return fail('Seção não encontrada.');
      return ok({
        id: doc.id,
        title: doc.title,
        correctionRevision: doc.correctionRevision,
        sourceVersion: doc.sourceVersion,
        ...result,
      });
    },
  );

  server.registerTool(
    'voxen_read_timespan',
    {
      title: 'Ler intervalo de tempo',
      description:
        'PASSO 3: lê as linhas cujo timestamp cai em [from_sec, to_sec] (segundos, inclusivo, ' +
        'cap de 200 linhas). Útil para ancorar num momento do vídeo. A resposta inclui a ' +
        'seção que contém o trecho.',
      inputSchema: {
        transcript_id: z.string().min(1).describe('ID da transcrição.'),
        from_sec: z.number().int().min(0).describe('Início em segundos.'),
        to_sec: z.number().int().min(0).describe('Fim em segundos (inclusivo).'),
        ...REVISION_FILTERS,
      },
      annotations: { ...READ_ONLY, title: 'Ler intervalo de tempo' },
    },
    async (args) => {
      let doc: Awaited<ReturnType<typeof loadDoc>>;
      try {
        doc = await loadDoc(userId, args.transcript_id, args);
      } catch (error) {
        const mapped = readError(error);
        if (mapped) return fail(`${mapped.code}: ${mapped.error}`);
        throw error;
      }
      const span = readTimespanFromMd(doc.md, args.from_sec, args.to_sec);
      return ok({
        id: doc.id,
        title: doc.title,
        correctionRevision: doc.correctionRevision,
        sourceVersion: doc.sourceVersion,
        ...span,
        section: span.lines.length > 0 ? findEnclosingSection(doc.md, span.lines[0]!.n) : null,
      });
    },
  );

  server.registerTool(
    'voxen_expand_context',
    {
      title: 'Expandir contexto',
      description:
        'PASSO 4: dada uma âncora (`line` OU `sec`), devolve uma janela de `radius` linhas ' +
        'antes/depois. Use só quando o trecho lido não bastar. A resposta inclui a seção ' +
        'da âncora. `truncated=true` indica corte pelo cap (200 linhas).',
      inputSchema: {
        transcript_id: z.string().min(1).describe('ID da transcrição.'),
        line: z.number().int().min(1).optional().describe('Linha-âncora (1-indexed).'),
        sec: z.number().int().min(0).optional().describe('Timestamp-âncora em segundos.'),
        radius: z
          .number()
          .int()
          .min(0)
          .max(200)
          .optional()
          .describe('Linhas antes/depois (padrão 8).'),
        ...REVISION_FILTERS,
      },
      annotations: { ...READ_ONLY, title: 'Expandir contexto' },
    },
    async (args) => {
      if (args.line === undefined && args.sec === undefined) {
        return fail('Informe line ou sec.');
      }
      let doc: Awaited<ReturnType<typeof loadDoc>>;
      try {
        doc = await loadDoc(userId, args.transcript_id, args);
      } catch (error) {
        const mapped = readError(error);
        if (mapped) return fail(`${mapped.code}: ${mapped.error}`);
        throw error;
      }
      const result = expandContextFromMd(doc.md, { line: args.line, sec: args.sec }, args.radius);
      if (!result) return fail('Âncora não encontrada.');
      return ok({
        id: doc.id,
        title: doc.title,
        correctionRevision: doc.correctionRevision,
        sourceVersion: doc.sourceVersion,
        ...result,
        section: findEnclosingSection(doc.md, result.anchorLine),
      });
    },
  );

  server.registerTool(
    'voxen_related',
    {
      title: 'Documentos relacionados',
      description:
        'PASSO 6: dado um `transcript_id` E/OU uma `query`, retorna transcrições/notas ' +
        'relacionadas via Brain (vizinhança no grafo) + FTS por título/tópico. Retorna ' +
        'id, título, tipo e motivo. `truncated=true` indica mais candidatos que o limite.',
      inputSchema: {
        transcript_id: z.string().min(1).optional().describe('ID da transcrição de origem.'),
        query: z
          .string()
          .min(1)
          .max(300)
          .optional()
          .describe('Termos de busca (alternativa/complemento).'),
        limit: z.number().int().min(1).max(25).optional().describe('Máx. itens (padrão 10).'),
      },
      annotations: { ...READ_ONLY, title: 'Documentos relacionados' },
    },
    async (args) => {
      if (!args.transcript_id && !args.query) return fail('Informe transcript_id ou query.');
      const page = await findRelatedPage(userId, {
        transcriptId: args.transcript_id,
        query: args.query,
        limit: args.limit,
      });
      return ok({ results: page.results, truncated: page.truncated });
    },
  );

  server.registerTool(
    'voxen_verify_citations',
    {
      title: 'Verificar citações',
      description:
        'PASSO 9: verifica DETERMINISTICAMENTE (sem LLM) se cada citação existe no trecho ' +
        'indicado do `.md`. Para cada claim, re-lê o trecho (por linhas, por tempo, ou o ' +
        'documento inteiro) e checa se a `quote` está presente (comparação normalizada). Use ' +
        'antes de afirmar fatos fortes.',
      inputSchema: {
        claims: z
          .array(
            z.object({
              transcript_id: z.string().min(1),
              quote: z.string().min(1).max(2000),
              from_line: z.number().int().min(1).optional(),
              to_line: z.number().int().min(1).optional(),
              from_sec: z.number().int().min(0).optional(),
              to_sec: z.number().int().min(0).optional(),
            }),
          )
          .min(1)
          .max(20)
          .describe('Lista de citações a verificar.'),
      },
      annotations: { ...READ_ONLY, title: 'Verificar citações' },
    },
    async (args) => {
      // Verificação sempre lê o conteúdo atual (sem REVISION_FILTERS): o objetivo
      // é validar a citação contra o que está armazenado agora.
      const cache = new Map<string, { md: string } | { error: string }>();
      const results = [];
      for (const claim of args.claims) {
        const tid = claim.transcript_id.trim();
        let entry = cache.get(tid);
        if (entry === undefined) {
          try {
            entry = { md: (await loadDoc(userId, tid, {})).md };
          } catch (error) {
            const mapped = readError(error);
            entry = {
              error: mapped ? `${mapped.code}: ${mapped.error}` : 'Transcrição indisponível.',
            };
          }
          cache.set(tid, entry);
        }
        if ('error' in entry) {
          results.push({ transcriptId: tid, supported: false, error: entry.error });
          continue;
        }
        const verdict = verifyClaimAgainstMd(entry.md, {
          quote: claim.quote,
          fromLine: claim.from_line,
          toLine: claim.to_line,
          fromSec: claim.from_sec,
          toSec: claim.to_sec,
        });
        results.push({ transcriptId: tid, ...verdict });
      }
      return ok({ results });
    },
  );
}
