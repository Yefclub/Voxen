// ============================================================================
// Voxen — Admin routes
// ============================================================================
// Endpoints protegidos por role ADMIN:
//   - GET  /api/admin/usuarios               — lista todos
//   - POST /api/admin/usuarios/:id/approve   — aprova pendente
//   - POST /api/admin/usuarios/:id/reject    — rejeita pendente
//
// Auth guard: pega session, checa role===ADMIN. Senão 401/403.
// ============================================================================

import { Hono } from 'hono';
import { auth } from '../lib/auth';
import { db } from '../lib/db';
import { getSetting, setSetting } from '../lib/settings';
import { deriveTunnelUrl } from '../lib/proxy-agent-tunnel';

type AdminVariables = {
  adminUserId: string;
};

export const adminRoutes = new Hono<{ Variables: AdminVariables }>();

// Middleware: require session + role ADMIN
adminRoutes.use('*', async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json({ error: 'Não autenticado.' }, 401);
  }
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, status: true },
  });
  if (!user || user.status !== 'APPROVED') {
    return c.json({ error: 'Acesso negado.' }, 403);
  }
  if (user.role !== 'ADMIN') {
    return c.json({ error: 'Acesso restrito a administradores.' }, 403);
  }
  c.set('adminUserId', session.user.id);
  return next();
});

// GET /api/admin/usuarios — lista todos
adminRoutes.get('/usuarios', async (c) => {
  const users = await db.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      status: true,
      role: true,
      monthlyBudgetUsd: true,
      approvedAt: true,
      approvedBy: true,
      createdAt: true,
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
  });
  return c.json({ users });
});

// POST /api/admin/usuarios/:id/approve
adminRoutes.post('/usuarios/:id/approve', async (c) => {
  const id = c.req.param('id');
  const adminId = c.get('adminUserId');
  const rawBody = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const monthlyBudgetUsd =
    typeof rawBody.monthlyBudgetUsd === 'number' ? rawBody.monthlyBudgetUsd : null;

  const user = await db.user.findUnique({ where: { id } });
  if (!user) {
    return c.json({ error: 'Usuário não encontrado.' }, 404);
  }
  if (user.status === 'APPROVED') {
    return c.json({ error: 'Usuário já aprovado.' }, 400);
  }

  const updated = await db.user.update({
    where: { id },
    data: {
      status: 'APPROVED',
      approvedAt: new Date(),
      approvedBy: adminId,
      monthlyBudgetUsd,
    },
    select: { id: true, email: true, status: true, approvedAt: true },
  });
  return c.json({ user: updated });
});

// POST /api/admin/usuarios/:id/reject
adminRoutes.post('/usuarios/:id/reject', async (c) => {
  const id = c.req.param('id');
  const user = await db.user.findUnique({ where: { id } });
  if (!user) {
    return c.json({ error: 'Usuário não encontrado.' }, 404);
  }
  if (user.status === 'REJECTED') {
    return c.json({ error: 'Usuário já rejeitado.' }, 400);
  }
  const updated = await db.user.update({
    where: { id },
    data: { status: 'REJECTED' },
    select: { id: true, email: true, status: true },
  });
  return c.json({ user: updated });
});

// GET /api/admin/instance — estado da instância (allow_signups)
adminRoutes.get('/instance', async (c) => {
  const allowSignupsRaw = await getSetting('allow_signups').catch(() => null);
  return c.json({ allowSignups: allowSignupsRaw !== 'false' });
});

// PATCH /api/admin/instance — atualiza flag de cadastros abertos
adminRoutes.patch('/instance', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof body.allowSignups !== 'boolean') {
    return c.json({ error: 'Campo "allowSignups" obrigatório (boolean).' }, 400);
  }
  await setSetting('allow_signups', body.allowSignups ? 'true' : 'false');
  return c.json({ allowSignups: body.allowSignups });
});

// GET /api/admin/mcp — estado do MCP server (token configurado? qual user?).
// Não retorna o token bruto (não há "ver token de novo" — só rotacionar).
adminRoutes.get('/mcp', async (c) => {
  const stored = await getSetting('mcp_api_token').catch(() => null);
  if (!stored) {
    return c.json({ enabled: false, userId: null, tokenPreview: null });
  }
  const [userId, token] = stored.split(':');
  return c.json({
    enabled: !!(userId && token),
    userId: userId ?? null,
    tokenPreview: token ? token.slice(0, 8) + '…' : null,
  });
});

// POST /api/admin/mcp/rotate — gera novo token MCP pra o admin chamando.
// Retorna o token UMA vez (não é recuperável depois). Sobrescreve o anterior.
adminRoutes.post('/mcp/rotate', async (c) => {
  const adminUserId = c.get('adminUserId');
  // 32 bytes hex = 64 chars, entropia adequada pra Bearer token.
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const token = Array.from(tokenBytes, (b) => b.toString(16).padStart(2, '0')).join('');
  await setSetting('mcp_api_token', `${adminUserId}:${token}`);
  return c.json({
    token,
    userId: adminUserId,
    warning: 'Salve este token agora — não será exibido novamente.',
  });
});

// POST /api/admin/mcp/prompt — gera prompt pronto para configurar um agente.
// Retorna o token dentro do prompt porque a ação é explícita, admin-only e
// feita sob demanda. Não incluir esse payload em logs.
adminRoutes.post('/mcp/prompt', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { appUrl?: unknown };
  const appUrl = normalizeAppOrigin(body.appUrl);
  if (!appUrl) {
    return c.json({ error: 'URL da aplicação inválida.' }, 400);
  }

  const stored = await getSetting('mcp_api_token').catch(() => null);
  if (!stored) {
    return c.json({ error: 'Token MCP não configurado.' }, 409);
  }
  const [userId, token] = stored.split(':');
  if (!userId || !token) {
    return c.json({ error: 'Token MCP inválido. Rotacione o token.' }, 409);
  }

  const endpoint = `${appUrl}/mcp`;
  const prompt = [
    'Você é um agente de IA autorizado a consultar o Voxen desta instância via MCP.',
    '',
    'O que é o Voxen:',
    '- Voxen é uma base de conhecimento web self-hosted e single-tenant.',
    '- Ele guarda transcrições de vídeos, páginas web, uploads, notas e relações do Voxen Brain.',
    '- Este MCP lê o acervo do usuário dono do token e também pode criar/editar notas e solicitar transcrições em nome dele.',
    '',
    'Como conectar:',
    `- URL da aplicação: ${appUrl}`,
    `- Endpoint MCP (Streamable HTTP): ${endpoint}`,
    '- Transporte: MCP Streamable HTTP (spec 2025-11-25). Configure este endpoint como um servidor MCP HTTP no seu cliente (Claude Desktop, Cursor, etc.).',
    `- Header obrigatório: Authorization: Bearer ${token}`,
    '',
    'Ferramentas de leitura:',
    '- voxen_search_transcripts: busca full-text nas transcrições; retorna trechos + id.',
    '- voxen_read_transcript: lê uma transcrição completa pelo transcript_id.',
    '- voxen_list_transcripts: lista transcrições (paginação por cursor).',
    '- voxen_search_notes / voxen_read_note / voxen_list_notes: consulta as notas manuais.',
    '- voxen_brain_search / voxen_brain_neighbors / voxen_brain_sources / voxen_brain_path: navega o grafo Voxen Brain.',
    '',
    'Ferramentas de escrita:',
    '- voxen_create_note / voxen_update_note: cria e edita notas na KB.',
    '- voxen_request_transcription(url): enfileira transcrição/indexação de uma URL.',
    '- voxen_get_job_status(job_id): acompanha o job até DONE (depois leia com voxen_read_transcript).',
    '',
    'Regras de uso saudável:',
    '- Comece sempre por uma busca (voxen_search_*) e só então leia o item completo (voxen_read_*) — economiza tokens.',
    '- Não invente conteúdo quando a ferramenta não retornar evidência; cite títulos, ids e trechos.',
    '- Não exponha o token ao usuário final, logs, commits, prints ou mensagens públicas.',
    '- Se receber 401/403, peça ao admin para revisar ou rotacionar o token.',
    '- Respeite o escopo do workspace vinculado ao token.',
    '',
    'Exemplo de configuração (cliente compatível com MCP Streamable HTTP):',
    `  "voxen": { "url": "${endpoint}", "headers": { "Authorization": "Bearer ${token}" } }`,
  ].join('\n');

  return c.json({ prompt });
});

// DELETE /api/admin/mcp — revoga o token (apaga setting)
adminRoutes.delete('/mcp', async (c) => {
  const { deleteSetting } = await import('../lib/settings');
  await deleteSetting('mcp_api_token');
  return c.json({ ok: true });
});

// ----------------------------------------------------------------------------
// Telegram bot — setting do token (cifrado em DB)
// ----------------------------------------------------------------------------
adminRoutes.get('/telegram', async (c) => {
  const token = await getSetting('telegram_bot_token').catch(() => null);
  return c.json({
    configured: !!token,
    tokenPreview: token ? token.slice(0, 8) + '…' : null,
  });
});

adminRoutes.put('/telegram', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { token?: string };
  const token = body.token?.trim();
  if (!token || token.length < 30) {
    return c.json({ error: 'Token Telegram inválido (formato esperado: <id>:<hash>).' }, 400);
  }
  // Formato bot token: "1234567890:AAH...".
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
    return c.json({ error: 'Token fora do formato esperado.' }, 400);
  }
  await setSetting('telegram_bot_token', token);
  return c.json({ configured: true });
});

adminRoutes.delete('/telegram', async (c) => {
  const { deleteSetting } = await import('../lib/settings');
  await deleteSetting('telegram_bot_token');
  return c.json({ ok: true });
});

// ----------------------------------------------------------------------------
// Agente de Proxy (túnel residencial) — token de conexão (cifrado em DB)
// ----------------------------------------------------------------------------
// Esta entrega cobre só a app web (token + status + UI). O runtime do chisel
// (servidor de túnel, cliente no agente, integração com worker) vem em PRs
// separadas. Ver spec 058. O token NUNCA é reexibido nem logado.

// GET /api/admin/proxy-agent — status (configured, tunnelUrl, agentStatus).
// NUNCA retorna o token (nem cifrado).
adminRoutes.get('/proxy-agent', async (c) => {
  const stored = await getSetting('proxy_agent_token').catch(() => null);
  const configured = !!stored;
  return c.json({
    configured,
    tunnelUrl: deriveTunnelUrl(),
    // Placeholder: o status real da conexão do agente chega na PR do runtime.
    agentStatus: configured ? 'unknown' : 'not_configured',
  });
});

// POST /api/admin/proxy-agent/token — gera/rotaciona o token.
// Retorna o token em texto puro UMA vez (não recuperável depois) + a URL do
// túnel. Sobrescreve qualquer token anterior.
adminRoutes.post('/proxy-agent/token', async (c) => {
  // 32 bytes aleatórios -> base64url. Alta entropia pra autenticar o túnel.
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const token = toBase64Url(tokenBytes);
  await setSetting('proxy_agent_token', token);
  // Aponta o worker pro SOCKS local do túnel (worker já é socks5-capable, spec
  // 058). Só seta se ainda não houver um proxy customizado configurado pelo
  // operador — não sobrescrevemos um http proxy intencional.
  const currentProxy = (await getSetting('yt_dlp_proxy_urls').catch(() => null))?.trim();
  if (!currentProxy) {
    await setSetting('yt_dlp_proxy_urls', LOCAL_TUNNEL_SOCKS_URL);
  }
  // Sincroniza o authfile do chisel e recarrega o servidor (best-effort).
  const { syncChiselAuthfile } = await import('../lib/proxy-agent-tunnel');
  await syncChiselAuthfile();
  return c.json({
    token,
    tunnelUrl: deriveTunnelUrl(),
    warning: 'Salve este token agora — não será exibido novamente.',
  });
});

// DELETE /api/admin/proxy-agent/token — revoga (apaga setting).
adminRoutes.delete('/proxy-agent/token', async (c) => {
  const { deleteSetting } = await import('../lib/settings');
  await deleteSetting('proxy_agent_token');
  // Limpa o proxy do worker SOMENTE se for exatamente o SOCKS local do túnel —
  // não apaga um proxy http custom que o operador tenha configurado.
  const currentProxy = (await getSetting('yt_dlp_proxy_urls').catch(() => null))?.trim();
  if (currentProxy === LOCAL_TUNNEL_SOCKS_URL) {
    await deleteSetting('yt_dlp_proxy_urls');
  }
  // Limpa o authfile (passa a {} -> nega conexões) e recarrega (best-effort).
  const { syncChiselAuthfile } = await import('../lib/proxy-agent-tunnel');
  await syncChiselAuthfile();
  return c.json({ ok: true });
});

// SOCKS5 local exposto pelo túnel chisel (bind em 127.0.0.1:1080 na VPS).
// socks5h => resolução de DNS no lado do agente residencial.
const LOCAL_TUNNEL_SOCKS_URL = 'socks5h://127.0.0.1:1080';

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function normalizeAppOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (raw.length < 8 || raw.length > 300) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}
