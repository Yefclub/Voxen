// ============================================================================
// /admin/integracoes — config de tokens MCP e integrações
// ============================================================================
// Página admin pra:
//  - rotacionar/revogar token MCP (Bearer pro endpoint /mcp)
// ============================================================================

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  Bot,
  Check,
  Copy,
  KeyRound,
  Network,
  RotateCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Label } from '../components/ui/label';
import { Spinner } from '../components/ui/spinner';
import { ApiError, apiGet, apiPost } from '../lib/api';
import { AnimatedPage } from '../components/motion/animated-page';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import { useI18n } from '../lib/i18n';

// Path do proxy de WebSocket do túnel na web do Voxen. Deve casar com o default
// do backend (PROXY_TUNNEL_PATH). Usado só como fallback de EXIBIÇÃO quando o
// backend não tem APP_BASE_URL e portanto não derivou a URL — aqui usamos o
// origin da janela (a URL que o admin já está acessando é a URL do Voxen).
const TUNNEL_PATH = '/_tunnel';

/**
 * Converte um origin HTTP(S) (ex.: o `window.location.origin`) na URL de conexão
 * do túnel: esquema http(s) preservado + path do proxy. O chisel client recebe a
 * URL em http(s) e faz o upgrade pra WebSocket sozinho — passar ws/wss quebra.
 * Retorna null se inválido.
 */
function originToTunnelUrl(origin: string): string | null {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.pathname = TUNNEL_PATH;
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

interface McpAdminStatus {
  enabled: boolean;
  userId: string | null;
  tokenPreview: string | null;
}

interface McpPromptResponse {
  prompt: string;
}

interface ProxyAgentStatus {
  configured: boolean;
  tunnelUrl: string | null;
  // Status REAL da conexão do agente (probe TCP ao SOCKS reverso local).
  connected: boolean;
  // true quando o chisel logou "address already in use" (2º agente tentou conectar).
  conflict: boolean;
}

interface ProxyAgentTokenResponse {
  token: string;
  tunnelUrl: string | null;
}

export function AdminIntegracoesPage(): React.ReactElement {
  const { t } = useI18n();

  return (
    <AnimatedPage>
      <div className="mx-auto max-w-3xl space-y-8 px-4 py-8 sm:space-y-10 sm:px-8 sm:py-12">
        <header className="space-y-3">
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--color-app-muted)] font-medium">
            <Sparkles className="h-3.5 w-3.5 text-violet-400" />
            {t('shell.admin')}
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
            {t('admin.integrations.title')}
          </h1>
          <p className="text-[15px] text-[var(--color-app-muted)] leading-relaxed">
            {t('admin.integrations.description')}
          </p>
        </header>

        <McpSection />
        <ProxyAgentSection />
      </div>
    </AnimatedPage>
  );
}

function McpSection(): React.ReactElement {
  const { t } = useI18n();
  const [status, setStatus] = useState<McpAdminStatus | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [copied, setCopied] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const [copyingPrompt, setCopyingPrompt] = useState(false);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh(): Promise<void> {
    try {
      const s = await apiGet<McpAdminStatus>('/api/admin/mcp');
      setStatus(s);
    } catch {
      setStatus({ enabled: false, userId: null, tokenPreview: null });
    }
  }

  async function rotate(): Promise<void> {
    setRotating(true);
    try {
      const r = await apiPost<{ token: string; userId: string }>('/api/admin/mcp/rotate', {});
      setNewToken(r.token);
      toast.success(t('admin.integrations.mcp.generated'));
      await refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('common.error'));
    } finally {
      setRotating(false);
    }
  }

  async function revoke(): Promise<void> {
    try {
      const res = await fetch('/api/admin/mcp', {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(t('common.error'));
      toast.success(t('admin.integrations.mcp.revoked'));
      setNewToken(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    }
  }

  async function copyToken(): Promise<void> {
    if (!newToken) return;
    try {
      await writeClipboardText(newToken, t('admin.integrations.copyError'));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignora
    }
  }

  async function copyAgentPrompt(): Promise<void> {
    if (!status?.enabled || copyingPrompt) return;
    setCopyingPrompt(true);
    try {
      const origin = window.location.origin;
      const res = await apiPost<McpPromptResponse>('/api/admin/mcp/prompt', { appUrl: origin });
      await writeClipboardText(res.prompt, t('admin.integrations.copyError'));
      setPromptCopied(true);
      toast.success(t('admin.integrations.mcp.promptCopied'));
      setTimeout(() => setPromptCopied(false), 1800);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('common.error'));
    } finally {
      setCopyingPrompt(false);
    }
  }

  if (!status) {
    return (
      <Card>
        <CardContent className="pt-6">
          <Spinner />
        </CardContent>
      </Card>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
    >
      <Card elevated>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display">
            <Bot className="h-4 w-4 text-emerald-400" />
            {t('admin.integrations.mcp.title')}
          </CardTitle>
          <CardDescription>{t('admin.integrations.mcp.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status.enabled && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 flex items-center gap-3">
              <Check className="h-4 w-4 text-emerald-400" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-zinc-100">{t('admin.integrations.mcp.enabled')}</p>
                <p className="text-[11px] text-[var(--color-app-muted)] font-mono">
                  {t('admin.integrations.mcp.copyToken').toLowerCase()}:{' '}
                  {status.tokenPreview ?? '••••'}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setConfirmRevoke(true)}>
                <Trash2 className="h-3.5 w-3.5" />
                {t('admin.integrations.revoke')}
              </Button>
            </div>
          )}

          {newToken && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-4 space-y-2">
              <p className="text-[11px] uppercase tracking-wider text-amber-300 font-medium">
                {t('admin.integrations.mcp.saveNow')}
              </p>
              <code className="block font-mono text-[12px] tracking-tight text-zinc-100 break-all bg-[var(--color-app-bg-elevated)] rounded px-2 py-2 border border-[var(--color-app-border)]">
                {newToken}
              </code>
              <Button variant="outline" size="sm" onClick={() => void copyToken()}>
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    {t('common.copied')}
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    {t('admin.integrations.mcp.copyToken')}
                  </>
                )}
              </Button>
              <p className="text-[11px] text-[var(--color-app-muted)] mt-2 leading-relaxed">
                {t('admin.integrations.mcp.clientHint', {
                  url: 'https://your-host/mcp',
                  header: 'Authorization: Bearer <token>',
                })}
              </p>
            </div>
          )}

          <div className="rounded-xl border border-violet-500/25 bg-violet-500/[0.06] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/12 text-violet-300">
                  <KeyRound className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-100">
                    {t('admin.integrations.mcp.promptTitle')}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--color-app-muted)]">
                    {status.enabled
                      ? t('admin.integrations.mcp.promptDescription')
                      : t('admin.integrations.mcp.promptDisabled')}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full sm:w-auto"
                onClick={() => void copyAgentPrompt()}
                disabled={!status.enabled || copyingPrompt}
                aria-label={t('admin.integrations.mcp.copyAgentPrompt')}
              >
                {copyingPrompt ? (
                  <Spinner />
                ) : promptCopied ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {promptCopied ? t('common.copied') : t('admin.integrations.mcp.copyAgentPrompt')}
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="primary" onClick={() => void rotate()} disabled={rotating}>
              {rotating ? <Spinner /> : <RotateCw className="h-3.5 w-3.5" />}
              {status.enabled
                ? t('admin.integrations.mcp.rotateToken')
                : t('admin.integrations.mcp.generateToken')}
            </Button>
          </div>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={confirmRevoke}
        onOpenChange={setConfirmRevoke}
        title={t('admin.integrations.mcp.revokeTitle')}
        description={t('admin.integrations.mcp.revokeDescription')}
        confirmLabel={t('admin.integrations.revoke')}
        variant="destructive"
        onConfirm={revoke}
      />
    </motion.div>
  );
}

function ProxyAgentSection(): React.ReactElement {
  const { t } = useI18n();
  const [status, setStatus] = useState<ProxyAgentStatus | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  // Polling ao vivo (~9s) pra refletir conexão/conflito do agente em tempo real.
  // Cleanup do interval no unmount.
  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 9000);
    return () => window.clearInterval(id);
  }, []);

  async function refresh(): Promise<void> {
    try {
      const s = await apiGet<ProxyAgentStatus>('/api/admin/proxy-agent');
      setStatus(s);
    } catch {
      setStatus({ configured: false, tunnelUrl: null, connected: false, conflict: false });
    }
  }

  async function generate(): Promise<void> {
    setGenerating(true);
    try {
      const r = await apiPost<ProxyAgentTokenResponse>('/api/admin/proxy-agent/token', {});
      setNewToken(r.token);
      toast.success(t('admin.integrations.proxy.generated'));
      await refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('common.error'));
    } finally {
      setGenerating(false);
    }
  }

  async function revoke(): Promise<void> {
    try {
      const res = await fetch('/api/admin/proxy-agent/token', {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(t('common.error'));
      toast.success(t('admin.integrations.proxy.revoked'));
      setNewToken(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    }
  }

  async function copyToken(): Promise<void> {
    if (!newToken) return;
    try {
      await writeClipboardText(newToken, t('admin.integrations.copyError'));
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 1500);
    } catch {
      // ignora
    }
  }

  async function copySnippet(): Promise<void> {
    try {
      await writeClipboardText(snippet, t('admin.integrations.copyError'));
      setCopiedSnippet(true);
      setTimeout(() => setCopiedSnippet(false), 1500);
    } catch {
      // ignora
    }
  }

  if (!status) {
    return (
      <Card>
        <CardContent className="pt-6">
          <Spinner />
        </CardContent>
      </Card>
    );
  }

  // URL de conexão auto-coletada: o backend deriva da APP_BASE_URL do próprio
  // Voxen (esquema http(s) preservado, path /_tunnel — o chisel client faz o
  // upgrade pra WebSocket sozinho). Se o backend não tiver
  // APP_BASE_URL setado, usamos o origin da janela atual como fallback de EXIBIÇÃO
  // (a URL que o admin está acessando agora já é a URL pública do Voxen).
  const displayTunnelUrl = status.tunnelUrl ?? originToTunnelUrl(window.location.origin);
  const tunnelUrl = displayTunnelUrl ?? '<TUNNEL_URL>';
  const tokenForSnippet = newToken ?? '<TOKEN>';
  // Comando de instalação do agente residencial (chisel client). A URL é a do
  // próprio Voxen + o remote SOCKS reverso esperado pelo authfile do server.
  const snippet = [
    'docker run -d --name voxen-proxy-agent \\',
    `  -e VOXEN_TUNNEL_URL="${tunnelUrl}" \\`,
    `  -e VOXEN_TUNNEL_TOKEN="${tokenForSnippet}" \\`,
    '  -e VOXEN_SOCKS_REMOTE="R:127.0.0.1:1080:socks" \\',
    '  ghcr.io/yefclub/voxen-proxy-agent:latest',
  ].join('\n');

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
    >
      <Card elevated>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display">
            <Network className="h-4 w-4 text-sky-400" />
            {t('admin.integrations.proxy.title')}
          </CardTitle>
          <CardDescription>{t('admin.integrations.proxy.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Indicador de conexão ao vivo (polling ~9s). Sempre visível. */}
          <div className="rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)]/40 px-4 py-3 flex items-center gap-3">
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                status.connected ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-500'
              }`}
              aria-hidden
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-zinc-100">
                {status.connected
                  ? t('admin.integrations.proxy.live.connected')
                  : t('admin.integrations.proxy.live.disconnected')}
              </p>
            </div>
          </div>

          {/* Aviso de múltiplos agentes (single-connection é garantido pelo bind). */}
          {status.conflict && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 flex items-start gap-3">
              <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-200/90">{t('admin.integrations.proxy.conflict')}</p>
            </div>
          )}

          {status.configured ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 flex items-center gap-3">
              <Check className="h-4 w-4 text-emerald-400" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-zinc-100">{t('admin.integrations.proxy.configured')}</p>
                <p className="text-[11px] text-[var(--color-app-muted)] mt-0.5">
                  {t('admin.integrations.proxy.managedNote')}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setConfirmRevoke(true)}>
                <Trash2 className="h-3.5 w-3.5" />
                {t('admin.integrations.revoke')}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-[var(--color-app-muted)]">
              {t('admin.integrations.proxy.notConfigured')}
            </p>
          )}

          {newToken && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-4 space-y-2">
              <p className="text-[11px] uppercase tracking-wider text-amber-300 font-medium">
                {t('admin.integrations.proxy.saveNow')}
              </p>
              <code className="block font-mono text-[12px] tracking-tight text-zinc-100 break-all bg-[var(--color-app-bg-elevated)] rounded px-2 py-2 border border-[var(--color-app-border)]">
                {newToken}
              </code>
              <Button variant="outline" size="sm" onClick={() => void copyToken()}>
                {copiedToken ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    {t('common.copied')}
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    {t('admin.integrations.proxy.copyToken')}
                  </>
                )}
              </Button>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>{t('admin.integrations.proxy.tunnelUrl')}</Label>
            {displayTunnelUrl ? (
              <>
                <code className="block font-mono text-[12px] text-zinc-100 break-all bg-[var(--color-app-bg-elevated)] rounded px-2 py-2 border border-[var(--color-app-border)]">
                  {displayTunnelUrl}
                </code>
                {!status.tunnelUrl && (
                  <p className="text-[11px] text-[var(--color-app-muted)]">
                    {t('admin.integrations.proxy.tunnelFromOrigin')}
                  </p>
                )}
              </>
            ) : (
              <p className="text-[12px] text-amber-300/90">
                {t('admin.integrations.proxy.tunnelMissing')}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>{t('admin.integrations.proxy.installTitle')}</Label>
            <p className="text-[11px] text-[var(--color-app-muted)] leading-relaxed">
              {t('admin.integrations.proxy.installHint')}
            </p>
            <pre className="overflow-x-auto font-mono text-[11px] leading-relaxed text-zinc-100 bg-[var(--color-app-bg-elevated)] rounded px-3 py-3 border border-[var(--color-app-border)]">
              {snippet}
            </pre>
            <Button variant="outline" size="sm" onClick={() => void copySnippet()}>
              {copiedSnippet ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  {t('common.copied')}
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  {t('admin.integrations.proxy.copySnippet')}
                </>
              )}
            </Button>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="primary" onClick={() => void generate()} disabled={generating}>
              {generating ? <Spinner /> : <RotateCw className="h-3.5 w-3.5" />}
              {status.configured
                ? t('admin.integrations.proxy.rotateToken')
                : t('admin.integrations.proxy.generateToken')}
            </Button>
          </div>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={confirmRevoke}
        onOpenChange={setConfirmRevoke}
        title={t('admin.integrations.proxy.revokeTitle')}
        description={t('admin.integrations.proxy.revokeDescription')}
        confirmLabel={t('admin.integrations.revoke')}
        variant="destructive"
        onConfirm={revoke}
      />
    </motion.div>
  );
}

async function writeClipboardText(text: string, errorMessage: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Alguns WebViews/headless bloqueiam Clipboard API mesmo em HTTPS.
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand('copy');
  textarea.remove();
  if (!ok) throw new Error(errorMessage);
}
