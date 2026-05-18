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

interface TelegramAdminStatus {
  configured: boolean;
  tokenPreview: string | null;
}

interface McpAdminStatus {
  enabled: boolean;
  userId: string | null;
  tokenPreview: string | null;
}

export function AdminIntegracoesPage(): React.ReactElement {
  return (
    <AnimatedPage>
      <div className="px-8 py-12 mx-auto max-w-3xl space-y-10">
        <header className="space-y-3">
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--color-app-muted)] font-medium">
            <Sparkles className="h-3.5 w-3.5 text-violet-400" />
            Admin
          </div>
          <h1 className="font-display text-4xl font-semibold tracking-[-0.03em]">Integrações</h1>
          <p className="text-[15px] text-[var(--color-app-muted)] leading-relaxed">
            Configure tokens pra Telegram bot e MCP server. Ambos cifrados em DB com a master key.
          </p>
        </header>

        <TelegramSection />
        <McpSection />
      </div>
    </AnimatedPage>
  );
}

function TelegramSection(): React.ReactElement {
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
      toast.error('Cole o token do bot.');
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
      if (!res.ok) throw new Error(data.error ?? 'Erro ao salvar.');
      toast.success('Token salvo. Worker telegram conecta em segundos.');
      setToken('');
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro.');
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
      if (!res.ok) throw new Error('Falha.');
      toast.success('Token revogado.');
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro.');
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
            Bot do Telegram
          </CardTitle>
          <CardDescription>
            Cole o token do bot (formato <code className="text-zinc-300">1234567890:AAH…</code>).
            Crie um bot via{' '}
            <a
              href="https://t.me/BotFather"
              target="_blank"
              rel="noreferrer"
              className="text-emerald-400 underline-offset-4 hover:underline"
            >
              @BotFather
            </a>{' '}
            no Telegram.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status.configured && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 flex items-center gap-3">
              <Check className="h-4 w-4 text-emerald-400" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-zinc-100">Bot ativo</p>
                <p className="text-[11px] text-[var(--color-app-muted)] font-mono">
                  token: {status.tokenPreview ?? '••••'}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setConfirmRevoke(true)}>
                <Trash2 className="h-3.5 w-3.5" />
                Revogar
              </Button>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="tg-token">{status.configured ? 'Substituir token' : 'Token'}</Label>
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
                  aria-label={showToken ? 'Ocultar' : 'Ver'}
                >
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button
                variant="primary"
                onClick={() => void save()}
                disabled={saving || !token.trim()}
              >
                {saving ? <Spinner /> : 'Salvar'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={confirmRevoke}
        onOpenChange={setConfirmRevoke}
        title="Revogar token do bot?"
        description="O bot vai parar de responder até admin configurar novo token."
        confirmLabel="Revogar"
        variant="destructive"
        onConfirm={revoke}
      />
    </motion.div>
  );
}

function McpSection(): React.ReactElement {
  const [status, setStatus] = useState<McpAdminStatus | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [copied, setCopied] = useState(false);

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
      toast.success('Token gerado. Copie agora — não será exibido novamente.');
      await refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro.');
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
      if (!res.ok) throw new Error('Falha.');
      toast.success('Token MCP revogado.');
      setNewToken(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro.');
    }
  }

  async function copyToken(): Promise<void> {
    if (!newToken) return;
    try {
      await navigator.clipboard.writeText(newToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
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
            MCP Server
          </CardTitle>
          <CardDescription>
            Expõe sua biblioteca via Model Context Protocol pra IAs externas (Claude Desktop,
            Cursor, agentes próprios) consultarem read-only.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status.enabled && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 flex items-center gap-3">
              <Check className="h-4 w-4 text-emerald-400" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-zinc-100">Habilitado</p>
                <p className="text-[11px] text-[var(--color-app-muted)] font-mono">
                  token: {status.tokenPreview ?? '••••'}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setConfirmRevoke(true)}>
                <Trash2 className="h-3.5 w-3.5" />
                Revogar
              </Button>
            </div>
          )}

          {newToken && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-4 space-y-2">
              <p className="text-[11px] uppercase tracking-wider text-amber-300 font-medium">
                Salve agora — não será exibido novamente
              </p>
              <code className="block font-mono text-[12px] tracking-tight text-zinc-100 break-all bg-[var(--color-app-bg-elevated)] rounded px-2 py-2 border border-[var(--color-app-border)]">
                {newToken}
              </code>
              <Button variant="outline" size="sm" onClick={() => void copyToken()}>
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    Copiado
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copiar token
                  </>
                )}
              </Button>
              <p className="text-[11px] text-[var(--color-app-muted)] mt-2 leading-relaxed">
                Configure no client MCP apontando pra <code>https://seu-host/mcp</code> com header{' '}
                <code>Authorization: Bearer &lt;token&gt;</code>.
              </p>
            </div>
          )}

          <Button variant="primary" onClick={() => void rotate()} disabled={rotating}>
            {rotating ? <Spinner /> : <RotateCw className="h-3.5 w-3.5" />}
            {status.enabled ? 'Rotacionar token' : 'Gerar token'}
          </Button>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={confirmRevoke}
        onOpenChange={setConfirmRevoke}
        title="Revogar token MCP?"
        description="Clients MCP que usam este token vão perder acesso até admin gerar novo."
        confirmLabel="Revogar"
        variant="destructive"
        onConfirm={revoke}
      />
    </motion.div>
  );
}

// Suprime warning de imports não usados em alguns lint configs
void KeyRound;
