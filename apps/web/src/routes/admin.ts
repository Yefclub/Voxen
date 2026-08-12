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
import type { Prisma } from '../../prisma-generated/client';
import { db } from '../lib/db';
import { isValidIanaTimezone, normalizeAppTimezone } from '../lib/app-timezone';
import { getAppTimezone, getSetting, setSettings } from '../lib/settings';
import { deriveTunnelUrl, probeAgentConnected, readConflictFlag } from '../lib/proxy-agent-tunnel';
import { storageDeletePrefix } from '../lib/storage';
import { beginUserMemoryShadowDeletion } from '../lib/memory/memory-provider';
import { adminAuthenticationRoutes } from './admin-authentication';
import { adminMcpRoutes } from './admin-mcp';
import { adminResearchPolicyRoutes } from './admin-research-policy';
import { requireApprovedAdmin, type AdminVariables } from './admin-guard';

export const adminRoutes = new Hono<{ Variables: AdminVariables }>();

class AdminUserActionError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

async function withAdminRosterLock<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    // Serializa ações que poderiam remover o último administrador aprovado.
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext('voxen:admin-roster'))");
    return operation(tx);
  });
}

async function assertMayRemoveApprovedAdmin(
  tx: Prisma.TransactionClient,
  user: {
    id: string;
    role: 'ADMIN' | 'USER';
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'DISABLED';
  },
): Promise<void> {
  if (user.role !== 'ADMIN' || user.status !== 'APPROVED') return;
  const count = await tx.user.count({ where: { role: 'ADMIN', status: 'APPROVED' } });
  if (count <= 1) {
    throw new AdminUserActionError(
      'É necessário manter pelo menos um administrador aprovado.',
      409,
    );
  }
}

adminRoutes.use('*', requireApprovedAdmin);

adminRoutes.route('/authentication', adminAuthenticationRoutes);
adminRoutes.route('/mcp', adminMcpRoutes);
adminRoutes.route('/research-policy', adminResearchPolicyRoutes);

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

// POST /api/admin/usuarios/:id/disable — bloqueia acesso e invalida sessões.
adminRoutes.post('/usuarios/:id/disable', async (c) => {
  const id = c.req.param('id');
  if (id === c.get('adminUserId')) {
    return c.json({ error: 'Não é permitido bloquear a própria conta administrativa.' }, 400);
  }
  try {
    const user = await withAdminRosterLock(async (tx) => {
      const target = await tx.user.findUnique({ where: { id } });
      if (!target) throw new AdminUserActionError('Usuário não encontrado.', 404);
      if (target.status === 'DISABLED')
        throw new AdminUserActionError('Usuário já está bloqueado.');
      await assertMayRemoveApprovedAdmin(tx, target);
      await tx.session.deleteMany({ where: { userId: id } });
      return tx.user.update({
        where: { id },
        data: { status: 'DISABLED' },
        select: { id: true, email: true, status: true, role: true },
      });
    });
    return c.json({ user });
  } catch (error) {
    if (error instanceof AdminUserActionError)
      return c.json({ error: error.message }, error.status);
    throw error;
  }
});

// POST /api/admin/usuarios/:id/enable — restaura somente uma conta bloqueada.
adminRoutes.post('/usuarios/:id/enable', async (c) => {
  const id = c.req.param('id');
  const user = await db.user.findUnique({ where: { id } });
  if (!user) return c.json({ error: 'Usuário não encontrado.' }, 404);
  if (user.status !== 'DISABLED')
    return c.json({ error: 'Somente usuários bloqueados podem ser reativados.' }, 400);
  const updated = await db.user.update({
    where: { id },
    data: { status: 'APPROVED', approvedAt: user.approvedAt ?? new Date() },
    select: { id: true, email: true, status: true, role: true },
  });
  return c.json({ user: updated });
});

// PATCH /api/admin/usuarios/:id/role — concede ou remove papel administrativo.
adminRoutes.patch('/usuarios/:id/role', async (c) => {
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as { role?: unknown };
  if (body.role !== 'ADMIN' && body.role !== 'USER') {
    return c.json({ error: 'Papel inválido. Use ADMIN ou USER.' }, 400);
  }
  const role = body.role;
  try {
    const user = await withAdminRosterLock(async (tx) => {
      const target = await tx.user.findUnique({ where: { id } });
      if (!target) throw new AdminUserActionError('Usuário não encontrado.', 404);
      if (target.role === role) return target;
      if (role === 'USER') await assertMayRemoveApprovedAdmin(tx, target);
      return tx.user.update({
        where: { id },
        data: { role },
        select: { id: true, email: true, status: true, role: true },
      });
    });
    return c.json({ user });
  } catch (error) {
    if (error instanceof AdminUserActionError)
      return c.json({ error: error.message }, error.status);
    throw error;
  }
});

// DELETE /api/admin/usuarios/:id — exclusão irreversível com confirmação por e-mail.
adminRoutes.delete('/usuarios/:id', async (c) => {
  const id = c.req.param('id');
  if (id === c.get('adminUserId')) {
    return c.json({ error: 'Não é permitido excluir a própria conta administrativa.' }, 400);
  }
  const body = (await c.req.json().catch(() => ({}))) as { confirmEmail?: unknown };
  const confirmEmail = typeof body.confirmEmail === 'string' ? body.confirmEmail : '';
  try {
    const target = await withAdminRosterLock(async (tx) => {
      const target = await tx.user.findUnique({ where: { id } });
      if (!target) throw new AdminUserActionError('Usuário não encontrado.', 404);
      if (confirmEmail !== target.email) {
        throw new AdminUserActionError(
          'Digite exatamente o e-mail da conta para confirmar a exclusão.',
        );
      }
      await assertMayRemoveApprovedAdmin(tx, target);
      return { id: target.id, email: target.email };
    });
    // Storage is I/O; do not keep a PostgreSQL transaction open during
    // a limpeza. Revalidamos o estado protegido logo antes da exclusão local.
    // Shadow memory is derived but external. Delete it first and fail strict so
    // an unreachable provider cannot leave personal memories orphaned after the
    // canonical user row disappears.
    const releaseMemoryFence = await beginUserMemoryShadowDeletion(target.id);
    try {
      await storageDeletePrefix(`workspaces/${target.id}/`);
      await withAdminRosterLock(async (tx) => {
        const current = await tx.user.findUnique({ where: { id: target.id } });
        if (!current) throw new AdminUserActionError('Usuário não encontrado.', 404);
        if (confirmEmail !== current.email) {
          throw new AdminUserActionError(
            'Digite exatamente o e-mail da conta para confirmar a exclusão.',
          );
        }
        await assertMayRemoveApprovedAdmin(tx, current);
        await tx.setting.deleteMany({ where: { scope: 'USER', userId: current.id } });
        await tx.verification.deleteMany({ where: { identifier: current.email } });
        await tx.user.delete({ where: { id: current.id } });
      });
    } finally {
      releaseMemoryFence();
    }
    return c.json({ ok: true });
  } catch (error) {
    if (error instanceof AdminUserActionError)
      return c.json({ error: error.message }, error.status);
    throw error;
  }
});

// GET /api/admin/instance — estado da instância (allow_signups + timezone)
adminRoutes.get('/instance', async (c) => {
  const [allowSignupsRaw, timezone] = await Promise.all([
    getSetting('allow_signups').catch(() => null),
    getAppTimezone().catch(() => 'America/Sao_Paulo'),
  ]);
  return c.json({ allowSignups: allowSignupsRaw !== 'false', timezone });
});

// PATCH /api/admin/instance — cadastros abertos e/ou fuso da instância
adminRoutes.patch('/instance', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const hasSignups = typeof body.allowSignups === 'boolean';
  const hasTimezone = typeof body.timezone === 'string';
  if (!hasSignups && !hasTimezone) {
    return c.json(
      { error: 'Envie "allowSignups" (boolean) e/ou "timezone" (IANA) para atualizar.' },
      400,
    );
  }
  const settings: Partial<Record<'app_timezone' | 'allow_signups', string>> = {};
  if (hasTimezone) {
    const tz = String(body.timezone).trim();
    if (!isValidIanaTimezone(tz)) {
      return c.json({ error: 'Timezone IANA inválido.' }, 400);
    }
    settings.app_timezone = normalizeAppTimezone(tz);
  }
  if (hasSignups) {
    settings.allow_signups = body.allowSignups ? 'true' : 'false';
  }
  await setSettings(settings, { actorUserId: c.get('adminUserId') });
  const [allowSignupsRaw, timezone] = await Promise.all([
    getSetting('allow_signups').catch(() => null),
    getAppTimezone(),
  ]);
  return c.json({
    allowSignups: allowSignupsRaw !== 'false',
    timezone,
  });
});

// ----------------------------------------------------------------------------
// Agente de Proxy (túnel residencial) — token de conexão (cifrado em DB)
// ----------------------------------------------------------------------------
// Esta entrega cobre só a app web (token + status + UI). O runtime do chisel
// (servidor de túnel, cliente no agente, integração com worker) vem em PRs
// separadas. Ver spec 058. O token NUNCA é reexibido nem logado.

// GET /api/admin/proxy-agent — status (configured, tunnelUrl, connected, conflict).
// NUNCA retorna o token (nem cifrado). O `connected` é REAL: faz um TCP connect
// best-effort (timeout curto) ao SOCKS reverso local — que o chisel só abre quando
// há um agente conectado. `conflict` lê o log do chisel buscando "address already
// in use" (2º agente tentou bindar). Ambos best-effort: em dev (sem chisel) viram
// false sem erro. As probes correm em paralelo pra não pendurar o request.
adminRoutes.get('/proxy-agent', async (c) => {
  const stored = await getSetting('proxy_agent_token').catch(() => null);
  const configured = !!stored;
  const enabledRaw = await getSetting('proxy_agent_enabled').catch(() => null);
  // Só faz sentido "ligado" quando há token; default = ligado (o token só é
  // gerado quando se quer usar o proxy). 'false' explícito desliga.
  const enabled = configured && enabledRaw !== 'false';
  const [connected, conflict] = await Promise.all([probeAgentConnected(), readConflictFlag()]);
  return c.json({
    configured,
    enabled,
    tunnelUrl: deriveTunnelUrl(),
    connected,
    conflict,
  });
});

// PATCH /api/admin/proxy-agent — liga/desliga o roteamento pelo agente de proxy
// SEM mexer no token nem no túnel. ON: aponta o worker pro SOCKS local; OFF:
// remove o proxy local (worker baixa direto). Não sobrescreve proxy http custom.
adminRoutes.patch('/proxy-agent', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof body.enabled !== 'boolean') {
    return c.json({ error: 'Campo "enabled" obrigatório (boolean).' }, 400);
  }
  // Não dá pra ativar sem um token (o worker apontaria pra um túnel inexistente
  // e as extrações falhariam em silêncio). A UI já desabilita o switch sem token;
  // o endpoint replica a guarda.
  if (body.enabled) {
    const stored = await getSetting('proxy_agent_token').catch(() => null);
    if (!stored) {
      return c.json({ error: 'Gere o token do agente de proxy antes de ativar.' }, 409);
    }
  }
  const settings: Partial<Record<'proxy_agent_enabled' | 'yt_dlp_proxy_urls', string | null>> = {
    proxy_agent_enabled: body.enabled ? 'true' : 'false',
  };
  const currentProxy = (await getSetting('yt_dlp_proxy_urls').catch(() => null))?.trim();
  if (body.enabled) {
    if (!currentProxy) {
      settings.yt_dlp_proxy_urls = LOCAL_TUNNEL_SOCKS_URL;
    }
  } else if (currentProxy === LOCAL_TUNNEL_SOCKS_URL) {
    settings.yt_dlp_proxy_urls = null;
  }
  await setSettings(settings, { actorUserId: c.get('adminUserId') });
  return c.json({ enabled: body.enabled });
});

// POST /api/admin/proxy-agent/token — gera/rotaciona o token.
// Retorna o token em texto puro UMA vez (não recuperável depois) + a URL do
// túnel. Sobrescreve qualquer token anterior.
adminRoutes.post('/proxy-agent/token', async (c) => {
  // 32 bytes aleatórios -> base64url. Alta entropia pra autenticar o túnel.
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const token = toBase64Url(tokenBytes);
  const settings: Partial<
    Record<'proxy_agent_token' | 'proxy_agent_enabled' | 'yt_dlp_proxy_urls', string | null>
  > = {
    proxy_agent_token: token,
    proxy_agent_enabled: 'true',
  };
  // Gerar token = intenção de usar o proxy → liga o switch.
  // Aponta o worker pro SOCKS local do túnel (worker já é socks5-capable, spec
  // 058). Só seta se ainda não houver um proxy customizado configurado pelo
  // operador — não sobrescrevemos um http proxy intencional.
  const currentProxy = (await getSetting('yt_dlp_proxy_urls').catch(() => null))?.trim();
  if (!currentProxy) {
    settings.yt_dlp_proxy_urls = LOCAL_TUNNEL_SOCKS_URL;
  }
  await setSettings(settings, { actorUserId: c.get('adminUserId') });
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
  const settings: Partial<
    Record<'proxy_agent_token' | 'proxy_agent_enabled' | 'yt_dlp_proxy_urls', string | null>
  > = { proxy_agent_token: null, proxy_agent_enabled: null };
  // Limpa o proxy do worker SOMENTE se for exatamente o SOCKS local do túnel —
  // não apaga um proxy http custom que o operador tenha configurado.
  const currentProxy = (await getSetting('yt_dlp_proxy_urls').catch(() => null))?.trim();
  if (currentProxy === LOCAL_TUNNEL_SOCKS_URL) {
    settings.yt_dlp_proxy_urls = null;
  }
  await setSettings(settings, { actorUserId: c.get('adminUserId') });
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
