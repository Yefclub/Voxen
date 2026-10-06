import { registerProgressiveTools } from './mcp-transcript-reading-tools';
import { z } from 'zod';
import { type McpServer } from '@modelcontextprotocol/server';
import { db } from '../lib/db';
import { ftsSearchTranscripts, searchKnowledgeBase } from '../lib/retrieval';
import { bounded, fail, ok, READ_ONLY, toMcpContentUrl } from './mcp-tool-helpers';
import { decodeMcpPageCursor, encodeMcpPageCursor, mcpPageBoundary } from './mcp-page-cursor';
import { registerMcpTranscriptCorrectionReadTools } from './mcp-transcript-correction-tools';
import { loadTranscriptCorrectionHead } from '../lib/transcript-correction-versioning';

export function registerTranscriptTools(
  server: McpServer,
  userId: string,
  publicOrigin: string,
): void {
  server.registerTool(
    'voxen_search_knowledge',
    {
      title: 'Buscar na Base de conhecimento',
      description:
        'Busca full-text na Base de conhecimento inteira do usuário: notas curadas, ' +
        'transcrições e contexto externo revisado e aceito. Use como primeiro passo para ' +
        'perguntas temáticas ou factuais. Retorna trechos, tipo da fonte e link de citação; ' +
        'uma nota só recebe preferência quando sua relevância é comparável à de uma transcrição.',
      inputSchema: {
        query: z.string().min(1).describe('Termos de busca em português (palavras-chave do tema).'),
        limit: z.number().int().min(1).max(25).optional().describe('Máx. resultados (padrão 8).'),
      },
      outputSchema: {
        results: z.array(
          z.object({
            id: z.string(),
            sourceType: z.enum(['transcript', 'note', 'external_enrichment']),
            title: z.string(),
            snippet: z.string(),
            rank: z.number(),
            href: z.string(),
            summary: z.string().nullable(),
            tags: z.array(z.string()),
            folder: z.string().nullable(),
            createdAt: z.string(),
            retrievalSource: z.enum(['lexical', 'semantic', 'hybrid']).optional(),
          }),
        ),
      },
      annotations: { ...READ_ONLY, title: 'Buscar na Base de conhecimento' },
    },
    async (args) => {
      const query = args.query.trim();
      if (!query) return fail('Parâmetro query vazio.');
      const rows = await searchKnowledgeBase(userId, query, bounded(args.limit, 8, 1, 25));
      return ok({
        results: rows.map((item) => ({
          ...item,
          href: toMcpContentUrl(publicOrigin, item.href),
          createdAt: item.createdAt.toISOString(),
        })),
      });
    },
  );

  server.registerTool(
    'voxen_search_transcripts',
    {
      title: 'Buscar nas transcrições',
      description:
        'Busca full-text (Postgres FTS, dicionário português) nas transcrições da Base de conhecimento do ' +
        'usuário: vídeos de YouTube/Instagram/TikTok, páginas web indexadas e uploads. ' +
        'USE ISTO PRIMEIRO para localizar conteúdo relevante — retorna trechos curtos com o ' +
        'termo destacado (« »), o título e um score de relevância (rank), NÃO o texto completo. ' +
        'Depois use voxen_outline e leia linhas/seções específicas; só use ' +
        'voxen_read_transcript se resumo e trechos não bastarem. ' +
        'Passe palavras-chave do tema (não precisa de operadores). ' +
        'Ex.: query="política monetária juros".',
      inputSchema: {
        query: z.string().min(1).describe('Termos de busca em português (palavras-chave do tema).'),
        limit: z.number().int().min(1).max(25).optional().describe('Máx. resultados (padrão 8).'),
      },
      outputSchema: {
        results: z.array(
          z.object({
            id: z.string(),
            title: z.string(),
            snippet: z.string().describe('Trecho com o termo destacado por « ».'),
            rank: z.number(),
            summary: z.string().nullable(),
            tags: z.array(z.string()),
            folder: z.string().nullable(),
            createdAt: z.string(),
            retrievalSource: z.enum(['lexical', 'semantic', 'hybrid']).optional(),
          }),
        ),
      },
      annotations: { ...READ_ONLY, title: 'Buscar nas transcrições' },
    },
    async (args) => {
      const query = args.query.trim();
      if (!query) return fail('Parâmetro query vazio.');
      const rows = await ftsSearchTranscripts(userId, query, bounded(args.limit, 8, 1, 25));
      // FtsResult.createdAt é Date (vem de $queryRaw) — serializa antes de
      // devolver, mesmo padrão do tool de chat equivalente.
      return ok({
        results: rows.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })),
      });
    },
  );

  server.registerTool(
    'voxen_list_transcripts',
    {
      title: 'Listar transcrições',
      description:
        'Lista as transcrições do usuário (mais recentes primeiro), com paginação por cursor. ' +
        'Use para navegar a Base de conhecimento quando não há um termo de busca específico. Prefira ' +
        'voxen_search_transcripts quando souber o que procura. Passe `cursor` (vindo de ' +
        '`nextCursor`) para a próxima página.',
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Itens por página (padrão 30).'),
        cursor: z
          .string()
          .max(2048)
          .optional()
          .describe('Cursor opaco da página seguinte (nextCursor).'),
      },
      outputSchema: {
        transcripts: z.array(
          z.object({
            id: z.string(),
            source: z.string(),
            url: z.string(),
            title: z.string(),
            channel: z.string().nullable(),
            durationSec: z.number(),
            createdAt: z.string(),
            summary: z.string().nullable(),
            tags: z.array(z.string()),
          }),
        ),
        nextCursor: z.string().nullable(),
      },
    },
    async (args) => {
      const limit = bounded(args.limit, 30, 1, 100);
      const pageContext = { userId, tool: 'transcripts' as const };
      const page = decodeMcpPageCursor(args.cursor, pageContext);
      if (!page.valid) return fail('MCP_INVALID_CURSOR: Restart pagination without a cursor.');
      const rows = await db.transcript.findMany({
        where: { userId, status: 'ACTIVE', ...mcpPageBoundary(page.position) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        select: {
          id: true,
          source: true,
          url: true,
          title: true,
          channel: true,
          durationSec: true,
          createdAt: true,
          summaryMd: true,
          tags: { select: { tag: { select: { name: true } } } },
        },
      });
      const selected = rows.slice(0, limit);
      const transcripts = selected.map((t) => ({
        id: t.id,
        source: t.source,
        url: t.url,
        title: t.title,
        channel: t.channel,
        durationSec: t.durationSec,
        createdAt: t.createdAt.toISOString(),
        summary: t.summaryMd,
        tags: t.tags.map((item) => item.tag.name),
      }));
      return ok({
        transcripts,
        nextCursor:
          rows.length > limit
            ? encodeMcpPageCursor(selected[selected.length - 1]!, pageContext)
            : null,
      });
    },
  );

  server.registerTool(
    'voxen_read_transcript',
    {
      title: 'Ler transcrição (completa)',
      description:
        'ÚLTIMO RECURSO (caro): lê o conteúdo COMPLETO de uma transcrição pelo `transcript_id`. ' +
        'Prefira o fluxo progressivo: voxen_search_transcripts -> voxen_outline -> ' +
        'voxen_read_lines / voxen_read_section / voxen_read_timespan. Use isto só quando ' +
        'precisar mesmo do documento inteiro.',
      inputSchema: {
        transcript_id: z.string().min(1).describe('ID da transcrição a ler.'),
      },
      outputSchema: {
        id: z.string(),
        title: z.string(),
        text: z.string(),
        summary: z.string().nullable(),
        flowchart: z.string().nullable(),
        correctionRevision: z.number(),
        correctionChecksum: z.string(),
        correctionState: z.string(),
        correctionStaleReason: z.string().nullable(),
        sourceVersion: z.number(),
        sourceChecksum: z.string().nullable(),
        tags: z.array(z.string()),
      },
      annotations: { ...READ_ONLY, title: 'Ler transcrição (completa)' },
    },
    async (args) => {
      const t = await db.transcript.findFirst({
        where: { id: args.transcript_id, userId, status: 'ACTIVE' },
        select: {
          id: true,
          title: true,
          plainText: true,
          summaryMd: true,
          flowchartMd: true,
          sourceVersion: true,
          sourceChecksum: true,
          tags: { select: { tag: { select: { name: true } } } },
        },
      });
      if (!t) return fail('Transcrição não encontrada (ou fora do escopo do token).');
      const head = await loadTranscriptCorrectionHead(userId, t.id);
      return ok({
        id: t.id,
        title: t.title,
        text: head.plainText,
        summary: t.summaryMd ?? null,
        flowchart: t.flowchartMd ?? null,
        correctionRevision: head.correctionRevision,
        correctionChecksum: head.checksum,
        correctionState: head.correctionState,
        correctionStaleReason: head.correctionStaleReason,
        sourceVersion: t.sourceVersion,
        sourceChecksum: t.sourceChecksum,
        tags: t.tags.map((item) => item.tag.name),
      });
    },
  );

  registerProgressiveTools(server, userId);
  registerMcpTranscriptCorrectionReadTools(server, userId);
}
