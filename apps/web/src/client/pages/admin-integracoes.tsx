// ============================================================================
// /admin/integracoes — config de tokens Telegram + MCP
// ============================================================================
// Página admin pra:
//  - setar/revogar token do bot Telegram (cifrado em Setting)
//  - rotacionar/revogar token MCP (Bearer pro endpoint /mcp)
// ============================================================================

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  Bot,
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Network,
  RotateCw,
  Send,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Spinner } from '../components/ui/spinner';
import { ApiError, apiGet, apiPost } from '../lib/api';
import { AnimatedPage } from '../components/motion/animated-page';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import { useI18n } from '../lib/i18n';

interface TelegramAdminStatus {
  configured: boolean;
  tokenPreview: string | null;
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
  agentStatus: 'unknown' | 'not_configured' | string;
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

        <TelegramSection />
        <McpSection />
        <ProxyAgentSection />
      </div>
    </AnimatedPage>
  );
}

function TelegramSection(): React.ReactElement {
  const { t } = useI18n();
  const [status, setStatus] = useState<TelegramAdminStatus | null>(null);
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh(): Promise<void> {
    try {
      const s = await apiGet<TelegramAdminStatus>('/api/admin/telegram');
      setStatus(s);
    } catch {
      setStatus({ configured: false, tokenPreview: null });
    }
  }

  async function save(): Promise<void> {
    if (!token.trim()) {
      toast.error(t('admin.integrations.telegram.tokenMissing'));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/admin/telegram', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? t('admin.integrations.telegram.saveError'));
      toast.success(t('admin.integrations.telegram.saved'));
      setToken('');
      await refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('admin.integrations.telegram.genericError'),
      );
    } finally {
      setSaving(false);
    }
  }

  async function revoke(): Promise<void> {
    try {
      const res = await fetch('/api/admin/telegram', {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(t('admin.integrations.telegram.revokeFailed'));
      toast.success(t('admin.integrations.telegram.revoked'));
      await refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('admin.integrations.telegram.genericError'),
      );
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
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      <Card elevated>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display">
            <Send className="h-4 w-4 text-violet-400" />
            {t('admin.integrations.telegram.title')}
          </CardTitle>
          <CardDescription>
            {t('admin.integrations.telegram.description', {
              format: '1234567890:AAH…',
              botFather: '@BotFather',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status.configured && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 flex items-center gap-3">
              <Check className="h-4 w-4 text-emerald-400" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-zinc-100">{t('admin.integrations.telegram.active')}</p>
                <p className="text-[11px] text-[var(--color-app-muted)] font-mono">
                  {t('admin.integrations.telegram.token').toLowerCase()}:{' '}
                  {status.tokenPreview ?? '••••'}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setConfirmRevoke(true)}>
                <Trash2 className="h-3.5 w-3.5" />
                {t('admin.integrations.revoke')}
              </Button>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="tg-token">
              {status.configured
                ? t('admin.integrations.telegram.replaceToken')
                : t('admin.integrations.telegram.token')}
            </Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="tg-token"
                  type={showToken ? 'text' : 'password'}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="1234567890:AAH..."
                  className="font-mono pr-10"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => setShowToken((v) => !v)}
                  className="absolute inset-y-0 right-3 flex items-center text-[var(--color-app-muted)] hover:text-zinc-100"
                  aria-label={
                    showToken ? t('admin.integrations.hide') : t('admin.integrations.show')
                  }
                >
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button
                variant="primary"
                onClick={() => void save()}
                disabled={saving || !token.trim()}
              >
                {saving ? <Spinner /> : t('common.save')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={confirmRevoke}
        onOpenChange={setConfirmRevoke}
        title={t('admin.integrations.telegram.revokeTitle')}
        description={t('admin.integrations.telegram.revokeDescription')}
        confirmLabel={t('admin.integrations.revoke')}
        variant="destructive"
        onConfirm={revoke}
      />
    </motion.div>
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
      toast.error(
        err instanceof ApiError ? err.message : t('admin.integrations.telegram.genericError'),
      );
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
      if (!res.ok) throw new Error(t('admin.integrations.telegram.revokeFailed'));
      toast.success(t('admin.integrations.mcp.revoked'));
      setNewToken(null);
      await refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('admin.integrations.telegram.genericError'),
      );
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
      toast.error(
        err instanceof ApiError ? err.message : t('admin.integrations.telegram.genericError'),
      );
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
                  {t('admin.integrations.telegram.token').toLowerCase()}:{' '}
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

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh(): Promise<void> {
    try {
      const s = await apiGet<ProxyAgentStatus>('/api/admin/proxy-agent');
      setStatus(s);
    } catch {
      setStatus({ configured: false, tunnelUrl: null, agentStatus: 'not_configured' });
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
      toast.error(
        err instanceof ApiError ? err.message : t('admin.integrations.telegram.genericError'),
      );
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
      if (!res.ok) throw new Error(t('admin.integrations.telegram.revokeFailed'));
      toast.success(t('admin.integrations.proxy.revoked'));
      setNewToken(null);
      await refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('admin.integrations.telegram.genericError'),
      );
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

  const tunnelUrl = status.tunnelUrl ?? '<TUNNEL_URL>';
  const tokenForSnippet = newToken ?? '<TOKEN>';
  // Comando de instalação do agente residencial (chisel client). O runtime real
  // chega em PR futura; aqui é só o snippet pronto pra colar.
  const snippet = [
    'docker run -d --name voxen-proxy-agent \\',
    `  -e VOXEN_TUNNEL_URL="${tunnelUrl}" \\`,
    `  -e VOXEN_TUNNEL_TOKEN="${tokenForSnippet}" \\`,
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
          {status.configured ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 flex items-center gap-3">
              <Check className="h-4 w-4 text-emerald-400" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-zinc-100">{t('admin.integrations.proxy.configured')}</p>
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
            {status.tunnelUrl ? (
              <code className="block font-mono text-[12px] text-zinc-100 break-all bg-[var(--color-app-bg-elevated)] rounded px-2 py-2 border border-[var(--color-app-border)]">
                {status.tunnelUrl}
              </code>
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
