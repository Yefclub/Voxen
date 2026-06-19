// ============================================================================
// /mcp — Model Context Protocol server (Streamable HTTP, spec 2025-11-25)
// ============================================================================
// Expõe o acervo do Voxen como fonte de contexto pra outras IAs (Claude Desktop,
// Cursor, agentes próprios) via o SDK oficial @modelcontextprotocol/sdk + o
// transporte Streamable HTTP do @hono/mcp.
//
// Auth: Bearer token armazenado em Setting `mcp_api_token` (cifrado), no formato
// `<userId>:<token>`. Cada token pertence a UM user — TODAS as queries das tools
// são escopadas por esse userId (isolamento de workspace).
//
// Stateless por design: um McpServer + transport são criados por request, com as
// tools fechando sobre o userId autenticado. Sem Mcp-Session-Id — alinhado com a
// direção stateless do protocolo e com o modelo single-tenant do Voxen.
// ============================================================================

import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPTransport } from '@hono/mcp';
import { db } from '../lib/db';
import { getSetting } from '../lib/settings';
import { createAutoJobForUser } from './jobs';
import { reindexNotesBrain } from '../lib/brain';
import { invalidateGraphCache } from '../lib/graph-cache';

export const mcpRoutes = new Hono();

// Guia de alto nível devolvido no `initialize` (campo `instructions`). É o
// primeiro contexto que qualquer agente recebe — explica o que é o Voxen, como
// as tools se encaixam e as boas práticas de uso.
const VOXEN_INSTRUCTIONS = [
  'Voxen é uma base de conhecimento self-hosted single-tenant. Este servidor MCP',
  'dá acesso ao acervo do usuário dono do token: transcrições de vídeos',
  '(YouTube/Instagram/TikTok), páginas web indexadas, uploads, notas manuais e o',
  'grafo "Voxen Brain". A maioria das tools é de leitura; algumas criam conteúdo.',
  '',
  'Fluxo de leitura:',
  '1. Para achar conteúdo, comece por voxen_search_transcripts / voxen_search_notes',
  '   (retornam trechos curtos + id). Só então use voxen_read_transcript /',
  '   voxen_read_note com o id para ler o conteúdo completo. Isso economiza tokens.',
  '2. Para navegar relações e entidades, use as tools voxen_brain_*.',
  '',
  'Fluxo de escrita:',
  '- voxen_create_note / voxen_update_note: salvar ou editar informação na KB.',
  '- voxen_request_transcription(url) enfileira um job; acompanhe com',
  '  voxen_get_job_status(job_id) até DONE e então voxen_read_transcript no resultado.',
  '',
  'Regras: cite títulos/ids/trechos ao usar o que recuperar; não invente conteúdo',
  'quando uma tool não retornar evidência; respeite o escopo do workspace do token.',
].join('\n');

// Anotação reutilizada pelas tools de LEITURA (domínio fechado = o acervo do
// próprio usuário). Os defaults do MCP assumem o pior caso, então declaramos
// explicitamente pra o cliente não tratar como perigoso. As write tools
// (voxen_create_note/update_note/request_transcription) têm annotations próprias.
const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

// ----------------------------------------------------------------------------
// HTTP entrypoint
// ----------------------------------------------------------------------------

mcpRoutes.all('/', async (c) => {
  if (!originAllowed(c)) {
    return c.json({ error: 'Origem não permitida.' }, 403);
  }
  const userId = await authenticateMcp(c);
  if (!userId) {
    return c.json(
      { error: 'Auth obrigatória ou inválida. Envie Authorization: Bearer <token>.' },
      401,
    );
  }
  const server = buildVoxenMcpServer(userId);
  // enableJsonResponse: responde application/json em vez de abrir um stream SSE
  // por request. Nossas tools são request/response (sem streaming do servidor),
  // então JSON é mais simples e compatível (curl, Open WebUI, etc.).
  const transport = new StreamableHTTPTransport({ enableJsonResponse: true });
  await server.connect(transport);
  const res = await transport.handleRequest(c);
  return res ?? c.body(null, 202);
});

// Defesa contra DNS rebinding (spec 2025-11-25): se houver header Origin (cliente
// browser), ele precisa bater com a origem da aplicação. Clientes não-browser
// (agentes/CLI) não mandam Origin — esses passam.
function originAllowed(c: Context): boolean {
  const origin = c.req.header('origin');
  if (!origin) return true;
  const appBase = process.env.APP_BASE_URL;
  if (!appBase) return true;
  try {
    return new URL(origin).origin === new URL(appBase).origin;
  } catch {
    return false;
  }
}

// Bearer token -> userId. Setting `mcp_api_token` = `<userId>:<token>` (cifrado).
// Confirma que o user ainda existe e está APPROVED. Comparação constant-time.
async function authenticateMcp(c: Context): Promise<string | null> {
  const token = (c.req.header('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const stored = await getSetting('mcp_api_token').catch(() => null);
  if (!stored) return null;
  const [storedUserId, storedToken] = stored.split(':');
  if (!storedUserId || !storedToken || !timingSafeEqual(token, storedToken)) return null;
  const user = await db.user.findUnique({ where: { id: storedUserId }, select: { status: true } });
  if (!user || user.status !== 'APPROVED') return null;
  return storedUserId;
}

// ----------------------------------------------------------------------------
// Server + tools (criados por request, fechando sobre o userId)
// ----------------------------------------------------------------------------

function buildVoxenMcpServer(userId: string): McpServer {
  const server = new McpServer(
    { name: 'voxen-mcp', version: '0.2.0' },
    { instructions: VOXEN_INSTRUCTIONS },
  );
  registerTranscriptTools(server, userId);
  registerNoteTools(server, userId);
  registerBrainTools(server, userId);
  registerWriteTools(server, userId);
  return server;
}

function registerWriteTools(server: McpServer, userId: string): void {
  server.registerTool(
    'voxen_create_note',
    {
      title: 'Criar nota',
      description:
        'Cria uma nota (markdown) na KB do usuário. Use para salvar/ingerir informação que ' +
        'o usuário pediu para guardar. Retorna o id da nota criada.',
      inputSchema: {
        title: z.string().min(1).max(200).describe('Título da nota.'),
        content: z.string().max(200_000).optional().describe('Conteúdo markdown.'),
      },
      outputSchema: { id: z.string(), title: z.string() },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
        title: 'Criar nota',
      },
    },
    async (args) => {
      const title = args.title.trim();
      if (!title) return fail('Título obrigatório.');
      const note = await db.note.create({
        data: { userId, kind: 'NOTE', title, content: args.content ?? '' },
        select: { id: true, title: true },
      });
      await reindexNotesBrain(userId).catch(() => {});
      await invalidateGraphCache(userId).catch(() => {});
      return ok({ id: note.id, title: note.title });
    },
  );

  server.registerTool(
    'voxen_update_note',
    {
      title: 'Editar nota',
      description:
        'Atualiza título e/ou conteúdo de uma nota existente (pelo note_id). Sobrescreve o ' +
        'conteúdo informado. Só edita notas (kind=NOTE) do próprio usuário.',
      inputSchema: {
        note_id: z.string().min(1).describe('ID da nota a editar.'),
        title: z.string().min(1).max(200).optional().describe('Novo título.'),
        content: z.string().max(200_000).optional().describe('Novo conteúdo markdown.'),
      },
      outputSchema: { id: z.string(), title: z.string() },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
        title: 'Editar nota',
      },
    },
    async (args) => {
      if (args.title === undefined && args.content === undefined) {
        return fail('Nada para atualizar: informe title e/ou content.');
      }
      const existing = await db.note.findFirst({
        where: { id: args.note_id, userId, kind: 'NOTE' },
        select: { id: true },
      });
      if (!existing) return fail('Nota não encontrada (ou não é editável).');
      const note = await db.note.update({
        where: { id: existing.id },
        data: {
          ...(args.title !== undefined ? { title: args.title.trim() } : {}),
          ...(args.content !== undefined ? { content: args.content } : {}),
        },
        select: { id: true, title: true },
      });
      await reindexNotesBrain(userId).catch(() => {});
      await invalidateGraphCache(userId).catch(() => {});
      return ok({ id: note.id, title: note.title });
    },
  );

  server.registerTool(
    'voxen_request_transcription',
    {
      title: 'Solicitar transcrição',
      description:
        'Enfileira a transcrição/indexação de uma URL (vídeo YouTube/Instagram/TikTok/X ou ' +
        'página web). Retorna um job_id; acompanhe com voxen_get_job_status(job_id) até ' +
        'status=DONE e então leia com voxen_read_transcript. Se a URL já foi transcrita, ' +
        'retorna o transcript_id existente.',
      inputSchema: {
        url: z.string().min(1).max(2048).describe('URL do vídeo ou página a transcrever/indexar.'),
      },
      outputSchema: {
        outcome: z.string(),
        jobId: z.string().nullable(),
        transcriptId: z.string().nullable(),
        message: z.string(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
        title: 'Solicitar transcrição',
      },
    },
    async (args) => {
      const result = await createAutoJobForUser(userId, args.url);
      switch (result.outcome) {
        case 'created':
          return ok({
            outcome: 'created',
            jobId: result.jobId,
            transcriptId: null,
            message: 'Job enfileirado. Use voxen_get_job_status(job_id) até status=DONE.',
          });
        case 'existing_transcript':
          return ok({
            outcome: 'existing_transcript',
            jobId: null,
            transcriptId: result.transcriptId,
            message: 'URL já transcrita. Use voxen_read_transcript(transcript_id).',
          });
        case 'inflight':
          return ok({
            outcome: 'inflight',
            jobId: result.jobId ?? null,
            transcriptId: null,
            message: 'URL já está sendo processada. Acompanhe com voxen_get_job_status.',
          });
        default:
          return fail(result.error);
      }
    },
  );

  server.registerTool(
    'voxen_get_job_status',
    {
      title: 'Status de um job',
      description:
        'Consulta o status de um job de transcrição/indexação: QUEUED, RUNNING, DONE, FAILED ' +
        'ou CANCELLED. Quando DONE, retorna transcript_id (use voxen_read_transcript); quando ' +
        'FAILED, retorna o erro.',
      inputSchema: {
        job_id: z.string().min(1).describe('ID do job retornado por request_transcription.'),
      },
      outputSchema: {
        id: z.string(),
        status: z.string(),
        transcriptId: z.string().nullable(),
        error: z.string().nullable(),
      },
      annotations: { ...READ_ONLY, title: 'Status de um job' },
    },
    async (args) => {
      const job = await db.job.findFirst({
        where: { id: args.job_id.trim(), userId },
        select: { id: true, status: true, transcriptId: true, errorMsg: true },
      });
      if (!job) return fail('Job não encontrado.');
      return ok({
        id: job.id,
        status: job.status,
        transcriptId: job.transcriptId ?? null,
        error: job.errorMsg ?? null,
      });
    },
  );
}

function registerTranscriptTools(server: McpServer, userId: string): void {
  server.registerTool(
    'voxen_search_transcripts',
    {
      title: 'Buscar nas transcrições',
      description:
        'Busca full-text (Postgres FTS, dicionário português) no acervo de transcrições do ' +
        'usuário: vídeos de YouTube/Instagram/TikTok, páginas web indexadas e uploads. ' +
        'USE ISTO PRIMEIRO para localizar conteúdo relevante — retorna trechos curtos com o ' +
        'termo destacado (« »), o título e um score de relevância (rank), NÃO o texto completo. ' +
        'Depois chame voxen_read_transcript com o `id` retornado para ler o conteúdo. ' +
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
          }),
        ),
      },
      annotations: { ...READ_ONLY, title: 'Buscar nas transcrições' },
    },
    async (args) => {
      const query = args.query.trim();
      if (!query) return fail('Parâmetro query vazio.');
      const limit = bounded(args.limit, 8, 1, 25);
      type Row = { id: string; title: string; snippet: string; rank: number };
      const rows = await db.$queryRaw<Row[]>`
        SELECT id, title,
          ts_headline('portuguese', "plainText", plainto_tsquery('portuguese', ${query}),
            'StartSel=«, StopSel=», MaxWords=22, MinWords=8, MaxFragments=1') AS snippet,
          ts_rank("searchVector", plainto_tsquery('portuguese', ${query})) AS rank
        FROM "Transcript"
        WHERE "userId" = ${userId}
          AND status = 'ACTIVE'::"ContentStatus"
          AND "searchVector" @@ plainto_tsquery('portuguese', ${query})
        ORDER BY rank DESC, "createdAt" DESC
        LIMIT ${limit}
      `;
      return ok({ results: rows });
    },
  );

  server.registerTool(
    'voxen_list_transcripts',
    {
      title: 'Listar transcrições',
      description:
        'Lista as transcrições do usuário (mais recentes primeiro), com paginação por cursor. ' +
        'Use para navegar o acervo quando não há um termo de busca específico. Prefira ' +
        'voxen_search_transcripts quando souber o que procura. Passe `cursor` (vindo de ' +
        '`next_cursor`) para a próxima página.',
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Itens por página (padrão 30).'),
        cursor: z.string().optional().describe('Cursor opaco da página seguinte (next_cursor).'),
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
          }),
        ),
        nextCursor: z.string().nullable(),
      },
    },
    async (args) => {
      const limit = bounded(args.limit, 30, 1, 100);
      const offset = decodeCursor(args.cursor);
      const rows = await db.transcript.findMany({
        where: { userId, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        select: {
          id: true,
          source: true,
          url: true,
          title: true,
          channel: true,
          durationSec: true,
          createdAt: true,
        },
      });
      const transcripts = rows.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() }));
      return ok({
        transcripts,
        nextCursor: rows.length === limit ? encodeCursor(offset + limit) : null,
      });
    },
  );

  server.registerTool(
    'voxen_read_transcript',
    {
      title: 'Ler transcrição',
      description:
        'Lê o conteúdo completo de uma transcrição pelo `transcript_id` (obtido em ' +
        'voxen_search_transcripts ou voxen_list_transcripts). Retorna o texto puro e o resumo ' +
        '(se houver). Conteúdo pode ser longo — prefira buscar antes para mirar o item certo.',
      inputSchema: {
        transcript_id: z.string().min(1).describe('ID da transcrição a ler.'),
      },
      outputSchema: {
        id: z.string(),
        title: z.string(),
        text: z.string(),
        summary: z.string().nullable(),
      },
      annotations: { ...READ_ONLY, title: 'Ler transcrição' },
    },
    async (args) => {
      const t = await db.transcript.findFirst({
        where: { id: args.transcript_id, userId, status: 'ACTIVE' },
        select: { id: true, title: true, plainText: true, summaryMd: true },
      });
      if (!t) return fail('Transcrição não encontrada (ou fora do escopo do token).');
      return ok({ id: t.id, title: t.title, text: t.plainText, summary: t.summaryMd ?? null });
    },
  );
}

function registerNoteTools(server: McpServer, userId: string): void {
  server.registerTool(
    'voxen_search_notes',
    {
      title: 'Buscar nas notas',
      description:
        'Busca full-text nas notas manuais do usuário (a KB escrita à mão, separada das ' +
        'transcrições). Retorna trechos curtos + id. Depois use voxen_read_note para ler.',
      inputSchema: {
        query: z.string().min(1).describe('Termos de busca em português.'),
        limit: z.number().int().min(1).max(25).optional().describe('Máx. resultados (padrão 8).'),
      },
      outputSchema: {
        results: z.array(
          z.object({ id: z.string(), title: z.string(), snippet: z.string(), rank: z.number() }),
        ),
      },
      annotations: { ...READ_ONLY, title: 'Buscar nas notas' },
    },
    async (args) => {
      const query = args.query.trim();
      if (!query) return fail('Parâmetro query vazio.');
      const limit = bounded(args.limit, 8, 1, 25);
      type Row = { id: string; title: string; snippet: string; rank: number };
      const rows = await db.$queryRaw<Row[]>`
        SELECT id, title,
          ts_headline('portuguese', coalesce(content, ''), plainto_tsquery('portuguese', ${query}),
            'StartSel=«, StopSel=», MaxWords=22, MinWords=8, MaxFragments=1') AS snippet,
          ts_rank("searchVector", plainto_tsquery('portuguese', ${query})) AS rank
        FROM "Note"
        WHERE "userId" = ${userId}
          AND kind = 'NOTE'
          AND "searchVector" @@ plainto_tsquery('portuguese', ${query})
        ORDER BY rank DESC, "updatedAt" DESC
        LIMIT ${limit}
      `;
      return ok({ results: rows });
    },
  );

  server.registerTool(
    'voxen_list_notes',
    {
      title: 'Listar notas',
      description:
        'Lista notas e pastas do usuário (mais recentes primeiro), com paginação por cursor. ' +
        '`kind` indica se é NOTE ou FOLDER; `parentId` dá a hierarquia.',
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Itens por página (padrão 30).'),
        cursor: z.string().optional().describe('Cursor opaco da página seguinte (next_cursor).'),
      },
      outputSchema: {
        notes: z.array(
          z.object({
            id: z.string(),
            parentId: z.string().nullable(),
            kind: z.string(),
            title: z.string(),
            updatedAt: z.string(),
          }),
        ),
        nextCursor: z.string().nullable(),
      },
    },
    async (args) => {
      const limit = bounded(args.limit, 30, 1, 100);
      const offset = decodeCursor(args.cursor);
      const rows = await db.note.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        skip: offset,
        take: limit,
        select: { id: true, parentId: true, kind: true, title: true, updatedAt: true },
      });
      const notes = rows.map((n) => ({ ...n, updatedAt: n.updatedAt.toISOString() }));
      return ok({
        notes,
        nextCursor: rows.length === limit ? encodeCursor(offset + limit) : null,
      });
    },
  );

  server.registerTool(
    'voxen_read_note',
    {
      title: 'Ler nota',
      description: 'Lê o conteúdo markdown completo de uma nota pelo `note_id`.',
      inputSchema: { note_id: z.string().min(1).describe('ID da nota a ler.') },
      outputSchema: {
        id: z.string(),
        title: z.string(),
        content: z.string().nullable(),
        kind: z.string(),
      },
      annotations: { ...READ_ONLY, title: 'Ler nota' },
    },
    async (args) => {
      const note = await db.note.findFirst({
        where: { id: args.note_id, userId },
        select: { id: true, title: true, content: true, kind: true },
      });
      if (!note) return fail('Nota não encontrada (ou fora do escopo do token).');
      return ok(note);
    },
  );
}

function registerBrainTools(server: McpServer, userId: string): void {
  server.registerTool(
    'voxen_brain_search',
    {
      title: 'Buscar nós no Brain',
      description:
        'Busca nós no grafo de conhecimento "Voxen Brain" por label, descrição ou key. ' +
        'Nós representam conteúdos, entidades, tópicos, claims e clusters derivados do acervo. ' +
        'Use voxen_brain_neighbors para expandir um nó e voxen_brain_sources para ver evidências.',
      inputSchema: {
        query: z.string().min(1).describe('Texto a casar em key/label/description.'),
        limit: z.number().int().min(1).max(30).optional().describe('Máx. nós (padrão 8).'),
        include_archived: z.boolean().optional().describe('Inclui nós arquivados (padrão false).'),
      },
      annotations: { ...READ_ONLY, title: 'Buscar nós no Brain' },
    },
    async (args) => {
      const query = args.query.trim();
      if (!query) return fail('Parâmetro query vazio.');
      const limit = bounded(args.limit, 8, 1, 30);
      const nodes = await db.brainNode.findMany({
        where: {
          userId,
          ...(args.include_archived ? {} : { status: 'ACTIVE' as const }),
          OR: [
            { key: { contains: query, mode: 'insensitive' } },
            { label: { contains: query, mode: 'insensitive' } },
            { description: { contains: query, mode: 'insensitive' } },
          ],
        },
        orderBy: { updatedAt: 'desc' },
        take: limit,
        select: BRAIN_NODE_SELECT,
      });
      return ok({ results: nodes, query });
    },
  );

  server.registerTool(
    'voxen_brain_neighbors',
    {
      title: 'Vizinhos de um nó',
      description:
        'Expande os vizinhos diretos de um nó do Brain (por id ou key), retornando o nó e suas ' +
        'arestas de entrada/saída com os nós conectados. Use para navegar relações a partir de ' +
        'um nó achado em voxen_brain_search.',
      inputSchema: {
        node_id: z.string().min(1).describe('ID ou key do nó central.'),
        limit: z.number().int().min(1).max(80).optional().describe('Máx. arestas (padrão 30).'),
        include_archived: z.boolean().optional(),
      },
      annotations: { ...READ_ONLY, title: 'Vizinhos de um nó' },
    },
    async (args) => {
      const ref = args.node_id.trim();
      if (!ref) return fail('node_id obrigatório.');
      const node = await db.brainNode.findFirst({
        where: {
          userId,
          OR: [{ id: ref }, { key: ref }],
          ...(args.include_archived ? {} : { status: 'ACTIVE' as const }),
        },
        select: BRAIN_NODE_SELECT,
      });
      if (!node) return fail('Nó não encontrado.');
      const edges = await db.brainEdge.findMany({
        where: {
          userId,
          OR: [{ fromNodeId: node.id }, { toNodeId: node.id }],
          ...(args.include_archived
            ? {}
            : {
                status: 'ACTIVE' as const,
                from: { status: 'ACTIVE' as const },
                to: { status: 'ACTIVE' as const },
              }),
        },
        orderBy: { updatedAt: 'desc' },
        take: bounded(args.limit, 30, 1, 80),
        select: {
          id: true,
          kind: true,
          method: true,
          confidence: true,
          status: true,
          fromNodeId: true,
          toNodeId: true,
          from: { select: BRAIN_NODE_SELECT },
          to: { select: BRAIN_NODE_SELECT },
        },
      });
      return ok({ node, edges });
    },
  );

  server.registerTool(
    'voxen_brain_sources',
    {
      title: 'Evidências de um nó/aresta',
      description:
        'Retorna as evidências (proveniência) de um nó, aresta ou sourceId do Brain: tipo de ' +
        'fonte, id, recorte de timestamps e trecho de evidência. Use para CITAR a origem de um ' +
        'claim ou relação antes de afirmar algo.',
      inputSchema: {
        ref: z.string().min(1).describe('node_id, edge_id, key do nó ou sourceId.'),
        limit: z.number().int().min(1).max(50).optional().describe('Máx. evidências (padrão 20).'),
      },
      annotations: { ...READ_ONLY, title: 'Evidências de um nó/aresta' },
    },
    async (args) => {
      const ref = args.ref.trim();
      if (!ref) return fail('ref obrigatório.');
      const sources = await db.brainSource.findMany({
        where: {
          userId,
          OR: [{ nodeId: ref }, { edgeId: ref }, { sourceId: ref }, { node: { key: ref } }],
        },
        orderBy: { createdAt: 'desc' },
        take: bounded(args.limit, 20, 1, 50),
        select: {
          id: true,
          nodeId: true,
          edgeId: true,
          sourceType: true,
          sourceId: true,
          chunkId: true,
          startSec: true,
          endSec: true,
          excerpt: true,
        },
      });
      return ok({ sources });
    },
  );

  server.registerTool(
    'voxen_brain_path',
    {
      title: 'Conexão entre dois nós',
      description:
        'Tenta encontrar a conexão (caminho de até 2 saltos) entre dois nós do Brain. Use para ' +
        'explicar COMO duas entidades/tópicos se relacionam no acervo.',
      inputSchema: {
        from_node_id: z.string().min(1).describe('ID ou key do nó de origem.'),
        to_node_id: z.string().min(1).describe('ID ou key do nó de destino.'),
      },
      annotations: { ...READ_ONLY, title: 'Conexão entre dois nós' },
    },
    async (args) => {
      const fromRef = args.from_node_id.trim();
      const toRef = args.to_node_id.trim();
      if (!fromRef || !toRef) return fail('from_node_id e to_node_id são obrigatórios.');
      type PathRow = {
        id: string;
        kind: string;
        method: string;
        fromNodeId: string;
        toNodeId: string;
        viaNodeId: string | null;
        viaLabel: string | null;
        depth: number;
      };
      const paths = await db.$queryRaw<PathRow[]>`
        WITH endpoints AS (
          SELECT
            (SELECT id FROM "BrainNode"
             WHERE "userId" = ${userId} AND status = 'ACTIVE'::"ContentStatus"
               AND (id = ${fromRef} OR key = ${fromRef})
             LIMIT 1) AS from_id,
            (SELECT id FROM "BrainNode"
             WHERE "userId" = ${userId} AND status = 'ACTIVE'::"ContentStatus"
               AND (id = ${toRef} OR key = ${toRef})
             LIMIT 1) AS to_id
        ),
        active_edges AS (
          SELECT e.*
          FROM "BrainEdge" e
          JOIN "BrainNode" f ON f.id = e."fromNodeId"
          JOIN "BrainNode" t ON t.id = e."toNodeId"
          WHERE e."userId" = ${userId}
            AND e.status = 'ACTIVE'::"ContentStatus"
            AND f.status = 'ACTIVE'::"ContentStatus"
            AND t.status = 'ACTIVE'::"ContentStatus"
        ),
        direct AS (
          SELECT e.id, e.kind::text AS kind, e.method, e."fromNodeId", e."toNodeId",
                 NULL::text AS "viaNodeId", NULL::text AS "viaLabel", 1 AS depth
          FROM active_edges e, endpoints ep
          WHERE ep.from_id IS NOT NULL
            AND ep.to_id IS NOT NULL
            AND ((e."fromNodeId" = ep.from_id AND e."toNodeId" = ep.to_id)
              OR (e."fromNodeId" = ep.to_id AND e."toNodeId" = ep.from_id))
        ),
        two_hop AS (
          SELECT e1.id || ':' || e2.id AS id,
                 e1.kind::text || ' -> ' || e2.kind::text AS kind,
                 e1.method || ' -> ' || e2.method AS method,
                 e1."fromNodeId",
                 e2."toNodeId",
                 via.id AS "viaNodeId",
                 via.label AS "viaLabel",
                 2 AS depth
          FROM active_edges e1
          JOIN active_edges e2 ON e1.id <> e2.id
          JOIN endpoints ep ON TRUE
          JOIN "BrainNode" via
            ON via.id = CASE
              WHEN e1."fromNodeId" = ep.from_id THEN e1."toNodeId"
              ELSE e1."fromNodeId"
            END
          WHERE ep.from_id IS NOT NULL
            AND ep.to_id IS NOT NULL
            AND (e1."fromNodeId" = ep.from_id OR e1."toNodeId" = ep.from_id)
            AND (e2."fromNodeId" = ep.to_id OR e2."toNodeId" = ep.to_id)
            AND via.id = CASE
              WHEN e2."fromNodeId" = ep.to_id THEN e2."toNodeId"
              ELSE e2."fromNodeId"
            END
          LIMIT 5
        )
        SELECT * FROM direct
        UNION ALL
        SELECT * FROM two_hop
        ORDER BY depth ASC
        LIMIT 10
      `;
      return ok({ paths });
    },
  );
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

const BRAIN_NODE_SELECT = {
  id: true,
  key: true,
  type: true,
  label: true,
  description: true,
  status: true,
  sourceType: true,
  sourceId: true,
  metadata: true,
  updatedAt: true,
} as const;

// Resultado de sucesso: bloco de texto (JSON serializado, compat) + structuredContent.
function ok(data: Record<string, unknown>): {
  content: { type: 'text'; text: string }[];
  structuredContent: Record<string, unknown>;
} {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

// Erro de tool (não de protocolo): isError=true para o modelo ver e se auto-corrigir.
function fail(message: string): { content: { type: 'text'; text: string }[]; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function bounded(value: number | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.trunc(parsed), max));
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const n = parseInt(Buffer.from(cursor, 'base64').toString('utf8'), 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64');
}

// Comparação constant-time pra evitar timing attacks no token.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
