// ============================================================================
// /mcp — Model Context Protocol server (HTTP transport, JSON-RPC 2.0)
// ============================================================================
// Expõe Voxen como fonte de contexto pra outras IAs (Claude Desktop, Cursor,
// agentes próprios). Tools são read-only sobre KB do user dono do token.
//
// Auth: Bearer token armazenado em Setting `mcp_api_token` (cifrado).
// Cada token pertence a UM user — todas queries são scoped por esse userId.
// Geração/rotação via /api/admin/mcp/token (admin endpoint).
//
// Protocol subset implementado:
//   - initialize    handshake (server info + capabilities)
//   - tools/list    lista tools disponíveis
//   - tools/call    executa uma tool com args
//
// Spec: https://modelcontextprotocol.io/specification
// ============================================================================

import { Hono } from 'hono';
import { db } from '../lib/db';
import { getSetting } from '../lib/settings';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export const mcpRoutes = new Hono();

// Tool spec exposta ao client MCP (formato similar ao OpenAI function calling)
const TOOLS = [
  {
    name: 'list_transcripts',
    description:
      'Lista as transcrições do user dono do token (vídeos YouTube/Instagram/TikTok + páginas web indexadas).',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Máx itens (padrão 30, máx 100).' },
      },
    },
  },
  {
    name: 'search_transcripts',
    description: 'Busca full-text nas transcrições. Retorna trechos com timestamps clicáveis.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Termos de busca em português.' },
        limit: { type: 'integer', description: 'Máx resultados (padrão 8).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_transcript',
    description: 'Lê o markdown completo de uma transcrição (com timestamps).',
    inputSchema: {
      type: 'object',
      properties: {
        transcript_id: { type: 'string' },
      },
      required: ['transcript_id'],
    },
  },
  {
    name: 'list_notes',
    description: 'Lista notas e pastas do user (KB manual).',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer' },
      },
    },
  },
  {
    name: 'search_notes',
    description: 'Busca full-text nas notas.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_note',
    description: 'Lê o conteúdo markdown de uma nota.',
    inputSchema: {
      type: 'object',
      properties: {
        note_id: { type: 'string' },
      },
      required: ['note_id'],
    },
  },
  {
    name: 'brain_search',
    description: 'Busca nós no Voxen Brain por label, descrição ou key.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer' },
        include_archived: { type: 'boolean' },
      },
      required: ['query'],
    },
  },
  {
    name: 'brain_neighbors',
    description: 'Expande vizinhos de um nó Brain por id ou key.',
    inputSchema: {
      type: 'object',
      properties: {
        node_id: { type: 'string' },
        limit: { type: 'integer' },
        include_archived: { type: 'boolean' },
      },
      required: ['node_id'],
    },
  },
  {
    name: 'brain_sources',
    description: 'Retorna evidências de um nó, aresta ou sourceId do Brain.',
    inputSchema: {
      type: 'object',
      properties: { ref: { type: 'string' }, limit: { type: 'integer' } },
      required: ['ref'],
    },
  },
  {
    name: 'brain_path',
    description: 'Tenta encontrar conexão direta entre dois nós Brain.',
    inputSchema: {
      type: 'object',
      properties: { from_node_id: { type: 'string' }, to_node_id: { type: 'string' } },
      required: ['from_node_id', 'to_node_id'],
    },
  },
];

mcpRoutes.post('/', async (c) => {
  // Auth: Bearer token bate com setting `mcp_api_token` E o token tem que
  // estar associado a um user. Setting é `<userId>:<token>` (separados por :).
  const authHeader = c.req.header('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return c.json(
      jsonRpcError(null, -32001, 'Auth obrigatória. Envie Authorization: Bearer <token>.'),
      401,
    );
  }
  const stored = await getSetting('mcp_api_token').catch(() => null);
  if (!stored) {
    return c.json(jsonRpcError(null, -32001, 'MCP server não configurado.'), 401);
  }
  const [storedUserId, storedToken] = stored.split(':');
  if (!storedUserId || !storedToken || !timingSafeEqual(token, storedToken)) {
    return c.json(jsonRpcError(null, -32001, 'Token inválido.'), 401);
  }
  // Confirma que o user ainda existe e está aprovado
  const user = await db.user.findUnique({
    where: { id: storedUserId },
    select: { status: true },
  });
  if (!user || user.status !== 'APPROVED') {
    return c.json(jsonRpcError(null, -32001, 'User do token não aprovado.'), 403);
  }
  const userId = storedUserId;

  // Parse JSON-RPC
  const body = (await c.req.json().catch(() => null)) as JsonRpcRequest | null;
  if (!body || body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    return c.json(jsonRpcError(null, -32600, 'Invalid Request'), 400);
  }
  const reqId = body.id ?? null;

  try {
    if (body.method === 'initialize') {
      return c.json(
        jsonRpcResult(reqId, {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'voxen-mcp', version: '0.1.0' },
          capabilities: { tools: {} },
        }),
      );
    }
    if (body.method === 'tools/list') {
      return c.json(jsonRpcResult(reqId, { tools: TOOLS }));
    }
    if (body.method === 'tools/call') {
      const params = body.params ?? {};
      const name = params.name as string | undefined;
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      if (!name) {
        return c.json(jsonRpcError(reqId, -32602, 'Faltou name nos params.'), 400);
      }
      const result = await executeTool(name, args, userId);
      return c.json(
        jsonRpcResult(reqId, {
          content: [
            { type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) },
          ],
          isError: typeof result === 'object' && result !== null && 'error' in result,
        }),
      );
    }
    return c.json(jsonRpcError(reqId, -32601, `Method not found: ${body.method}`), 404);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return c.json(jsonRpcError(reqId, -32603, `Internal error: ${msg}`), 500);
  }
});

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  userId: string,
): Promise<unknown> {
  if (name === 'list_transcripts') {
    const limit = boundedInt(args.limit, 30, 1, 100);
    const transcripts = await db.transcript.findMany({
      where: { userId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
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
    return { transcripts };
  }
  if (name === 'search_transcripts') {
    const query = String(args.query ?? '').trim();
    if (!query) return { error: 'Parâmetro query vazio.' };
    const limit = boundedInt(args.limit, 8, 1, 25);
    type Row = {
      id: string;
      title: string;
      snippet: string;
      rank: number;
    };
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
    return { results: rows };
  }
  if (name === 'read_transcript') {
    const id = String(args.transcript_id ?? '');
    const t = await db.transcript.findFirst({
      where: { id, userId, status: 'ACTIVE' },
      select: { id: true, title: true, plainText: true, summaryMd: true },
    });
    if (!t) return { error: 'Transcrição não encontrada.' };
    return { id: t.id, title: t.title, text: t.plainText, summary: t.summaryMd ?? null };
  }
  if (name === 'list_notes') {
    const limit = boundedInt(args.limit, 30, 1, 100);
    const notes = await db.note.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        parentId: true,
        kind: true,
        title: true,
        updatedAt: true,
      },
    });
    return { notes };
  }
  if (name === 'search_notes') {
    const query = String(args.query ?? '').trim();
    if (!query) return { error: 'Parâmetro query vazio.' };
    const limit = boundedInt(args.limit, 8, 1, 25);
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
    return { results: rows };
  }
  if (name === 'read_note') {
    const id = String(args.note_id ?? '');
    const note = await db.note.findFirst({
      where: { id, userId },
      select: { id: true, title: true, content: true, kind: true },
    });
    if (!note) return { error: 'Nota não encontrada.' };
    return note;
  }
  if (name === 'brain_search') {
    const query = String(args.query ?? '').trim();
    if (!query) return { error: 'Parâmetro query vazio.' };
    const limit = boundedInt(args.limit, 8, 1, 30);
    const includeArchived = args.include_archived === true;
    const nodes = await db.brainNode.findMany({
      where: {
        userId,
        ...(includeArchived ? {} : { status: 'ACTIVE' as const }),
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
    return { results: nodes, query };
  }
  if (name === 'brain_neighbors') {
    const ref = String(args.node_id ?? '').trim();
    if (!ref) return { error: 'node_id obrigatório.' };
    const includeArchived = args.include_archived === true;
    const node = await db.brainNode.findFirst({
      where: {
        userId,
        OR: [{ id: ref }, { key: ref }],
        ...(includeArchived ? {} : { status: 'ACTIVE' as const }),
      },
      select: BRAIN_NODE_SELECT,
    });
    if (!node) return { error: 'Nó não encontrado.' };
    const edges = await db.brainEdge.findMany({
      where: {
        userId,
        OR: [{ fromNodeId: node.id }, { toNodeId: node.id }],
        ...(includeArchived
          ? {}
          : {
              status: 'ACTIVE' as const,
              from: { status: 'ACTIVE' as const },
              to: { status: 'ACTIVE' as const },
            }),
      },
      orderBy: { updatedAt: 'desc' },
      take: boundedInt(args.limit, 30, 1, 80),
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
    return { node, edges };
  }
  if (name === 'brain_sources') {
    const ref = String(args.ref ?? '').trim();
    if (!ref) return { error: 'ref obrigatório.' };
    const sources = await db.brainSource.findMany({
      where: {
        userId,
        OR: [{ nodeId: ref }, { edgeId: ref }, { sourceId: ref }, { node: { key: ref } }],
      },
      orderBy: { createdAt: 'desc' },
      take: boundedInt(args.limit, 20, 1, 50),
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
    return { sources };
  }
  if (name === 'brain_path') {
    const fromRef = String(args.from_node_id ?? '').trim();
    const toRef = String(args.to_node_id ?? '').trim();
    if (!fromRef || !toRef) return { error: 'from_node_id e to_node_id são obrigatórios.' };
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
    return { paths };
  }
  return { error: `Tool desconhecida: ${name}` };
}

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

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.trunc(parsed), max));
}

function jsonRpcResult(id: number | string | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(
  id: number | string | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, data } };
}

// Comparação constant-time pra evitar timing attacks no token
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
