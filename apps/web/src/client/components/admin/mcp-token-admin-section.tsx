import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Bot, Check, Copy, KeyRound, RotateCw, Trash2 } from '@/components/ui/icons';
import { toast } from '@/lib/toast';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Spinner } from '../ui/spinner';
import { Switch } from '../ui/switch';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { writeClipboardText } from '../../lib/clipboard';
import { McpOAuthAdminSection } from './mcp-oauth-admin-section';

interface McpAdminStatus {
  enabled: boolean;
  userId: string | null;
  tokenPreview: string | null;
  allowUserTokens: boolean;
  oauthEnabled: boolean;
  legacyTokenConfigured: boolean;
  tokens: {
    id: string;
    label: string;
    scopes: string[];
    revokedAt: string | null;
    user: { email: string; name: string };
  }[];
  oauthClients: {
    clientId: string;
    name: string | null;
    uri: string | null;
    public: boolean | null;
    disabled: boolean | null;
    requirePKCE: boolean | null;
    scopes: string[];
    redirectHosts: string[];
    consentCount: number;
  }[];
}

interface McpPromptResponse {
  prompt: string;
}

export function McpTokenAdminSection(): React.ReactElement {
  const { t } = useI18n();
  const [status, setStatus] = useState<McpAdminStatus | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [newTokenId, setNewTokenId] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [tokenToRevoke, setTokenToRevoke] = useState<string | null>(null);
  const [updatingPolicy, setUpdatingPolicy] = useState(false);
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
      setStatus({
        enabled: false,
        userId: null,
        tokenPreview: null,
        allowUserTokens: false,
        oauthEnabled: false,
        legacyTokenConfigured: false,
        tokens: [],
        oauthClients: [],
      });
    }
  }

  async function rotate(): Promise<void> {
    setRotating(true);
    try {
      const r = await apiPost<{ token: string; metadata: { id: string } }>(
        '/api/admin/mcp/rotate',
        {},
      );
      setNewToken(r.token);
      setNewTokenId(r.metadata.id);
      toast.success(t('admin.integrations.mcp.generated'));
      await refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('common.error'));
    } finally {
      setRotating(false);
    }
  }

  async function revoke(tokenId: string): Promise<void> {
    try {
      await apiDelete(`/api/admin/mcp/tokens/${tokenId}`);
      toast.success(t('admin.integrations.mcp.revoked'));
      if (newTokenId === tokenId) {
        setNewToken(null);
        setNewTokenId(null);
      }
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    }
  }

  async function toggleUserTokens(enabled: boolean): Promise<void> {
    setUpdatingPolicy(true);
    try {
      await apiPatch('/api/admin/mcp', { allowUserTokens: enabled });
      await refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('common.error'));
    } finally {
      setUpdatingPolicy(false);
    }
  }

  async function revokeLegacy(): Promise<void> {
    try {
      await apiDelete('/api/admin/mcp');
      toast.success(t('admin.integrations.mcp.legacyRevoked'));
      await refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('common.error'));
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
    if (copyingPrompt) return;
    setCopyingPrompt(true);
    try {
      const origin = window.location.origin;
      const res = await apiPost<McpPromptResponse>('/api/admin/mcp/prompt', {
        appUrl: origin,
      });
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
                <p className="text-sm text-[var(--color-app-fg)]">
                  {t('admin.integrations.mcp.enabled')}
                </p>
                <p className="text-[11px] text-[var(--color-app-muted)] font-mono">
                  {t('admin.integrations.mcp.activeCount', {
                    count: status.tokens.filter((token) => !token.revokedAt).length,
                  })}
                </p>
              </div>
            </div>
          )}

          <div className="rounded-lg border border-[var(--color-app-border)] px-4 py-3 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-[var(--color-app-fg)]">
                  {t('admin.integrations.mcp.userPolicy')}
                </p>
                <p className="text-xs text-[var(--color-app-muted)]">
                  {t('admin.integrations.mcp.userPolicyHint')}
                </p>
              </div>
              <Switch
                checked={status.allowUserTokens}
                onCheckedChange={(enabled) => void toggleUserTokens(enabled)}
                disabled={updatingPolicy}
                aria-label={t('admin.integrations.mcp.userPolicy')}
              />
            </div>
            {status.legacyTokenConfigured && (
              <div className="flex items-center justify-between gap-3 border-t border-[var(--color-app-border)] pt-3">
                <p className="text-xs text-amber-300">
                  {t('admin.integrations.mcp.legacyPending')}
                </p>
                <Button variant="outline" size="sm" onClick={() => void revokeLegacy()}>
                  <Trash2 className="h-3.5 w-3.5" />
                  {t('admin.integrations.mcp.revokeLegacy')}
                </Button>
              </div>
            )}
          </div>

          <McpOAuthAdminSection
            enabled={status.oauthEnabled}
            clients={status.oauthClients}
            onChanged={refresh}
          />

          {status.tokens.length > 0 && (
            <div className="rounded-lg border border-[var(--color-app-border)] divide-y divide-[var(--color-app-border)]">
              {status.tokens.map((token) => (
                <div key={token.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-[var(--color-app-fg)]">{token.label}</p>
                    <p className="truncate text-xs text-[var(--color-app-muted)]">
                      {token.user.name || token.user.email} · {token.scopes.join(', ')}
                    </p>
                  </div>
                  {token.revokedAt ? (
                    <Badge variant="outline">{t('admin.integrations.mcp.revokedStatus')}</Badge>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setTokenToRevoke(token.id);
                        setConfirmRevoke(true);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {t('admin.integrations.revoke')}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          {newToken && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-4 space-y-2">
              <p className="text-[11px] uppercase tracking-wider text-amber-300 font-medium">
                {t('admin.integrations.mcp.saveNow')}
              </p>
              <code className="block font-mono text-[12px] tracking-tight text-[var(--color-app-fg)] break-all bg-[var(--color-app-bg-elevated)] rounded px-2 py-2 border border-[var(--color-app-border)]">
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
                  <p className="text-sm font-medium text-[var(--color-app-fg)]">
                    {t('admin.integrations.mcp.promptTitle')}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--color-app-muted)]">
                    {t('admin.integrations.mcp.promptDescription')}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full sm:w-auto"
                onClick={() => void copyAgentPrompt()}
                disabled={copyingPrompt}
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
        onConfirm={() => (tokenToRevoke ? revoke(tokenToRevoke) : Promise.resolve())}
      />
    </motion.div>
  );
}
