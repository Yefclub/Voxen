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
    const limit = Math.min(Number(args.limit ?? 30), 100);
    const transcripts = await db.transcript.findMany({
      where: { userId },
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
    const limit = Math.min(Number(args.limit ?? 8), 25);
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
        AND "searchVector" @@ plainto_tsquery('portuguese', ${query})
      ORDER BY rank DESC, "createdAt" DESC
      LIMIT ${limit}
    `;
    return { results: rows };
  }
  if (name === 'read_transcript') {
    const id = String(args.transcript_id ?? '');
    const t = await db.transcript.findFirst({
      where: { id, userId },
      select: { id: true, title: true, plainText: true, summaryMd: true },
    });
    if (!t) return { error: 'Transcrição não encontrada.' };
    return { id: t.id, title: t.title, text: t.plainText, summary: t.summaryMd ?? null };
  }
  if (name === 'list_notes') {
    const limit = Math.min(Number(args.limit ?? 30), 100);
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
    const limit = Math.min(Number(args.limit ?? 8), 25);
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
  return { error: `Tool desconhecida: ${name}` };
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
