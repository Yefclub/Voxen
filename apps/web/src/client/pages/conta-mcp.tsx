import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Check, Copy, KeyRound, ShieldCheck, Trash2 } from '@/components/ui/icons';
import { toast } from '@/lib/toast';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { PageHeader, PageShell } from '../components/ui/page-shell';
import { Spinner } from '../components/ui/spinner';
import { Switch } from '../components/ui/switch';
import { ApiError, apiDelete, apiGet, apiPost } from '../lib/api';
import { useI18n } from '../lib/i18n';

interface PersonalMcpToken {
  id: string;
  label: string;
  scopes: ('READ' | 'WRITE')[];
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

interface PersonalMcpStatus {
  tokens: PersonalMcpToken[];
  allowCreate: boolean;
}

export function ContaMcpPage(): React.ReactElement {
  const { t, locale } = useI18n();
  const [status, setStatus] = useState<PersonalMcpStatus | null>(null);
  const [label, setLabel] = useState('');
  const [writeAccess, setWriteAccess] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<PersonalMcpToken | null>(null);
  const endpoint = useMemo(() => `${window.location.origin}/mcp`, []);

  async function refresh(): Promise<void> {
    try {
      setStatus(await apiGet<PersonalMcpStatus>('/api/mcp/tokens'));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('common.error'));
      setStatus({ tokens: [], allowCreate: false });
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function createToken(): Promise<void> {
    if (!label.trim() || creating) return;
    setCreating(true);
    try {
      const response = await apiPost<{ token: string }>('/api/mcp/tokens', {
        label: label.trim(),
        scopes: writeAccess ? ['READ', 'WRITE'] : ['READ'],
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      });
      setSecret(response.token);
      setLabel('');
      setWriteAccess(false);
      setExpiresAt('');
      toast.success(t('account.mcp.created'));
      await refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('common.error'));
    } finally {
      setCreating(false);
    }
  }

  async function revokeToken(token: PersonalMcpToken): Promise<void> {
    try {
      await apiDelete(`/api/mcp/tokens/${token.id}`);
      toast.success(t('account.mcp.revoked'));
      await refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('common.error'));
    }
  }

  async function copySecret(): Promise<void> {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t('admin.integrations.copyError'));
    }
  }

  function tokenState(token: PersonalMcpToken): 'active' | 'expired' | 'revoked' {
    if (token.revokedAt) return 'revoked';
    if (token.expiresAt && new Date(token.expiresAt) <= new Date()) return 'expired';
    return 'active';
  }

  function formatDate(value: string): string {
    return new Date(value).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
  }

  return (
    <PageShell width="reading">
      <PageHeader
        eyebrow={t('account.eyebrow')}
        icon={KeyRound}
        iconClassName="text-emerald-400"
        title={t('account.mcp.title')}
        description={t('account.mcp.description')}
      />

      {secret && (
        <Card elevated className="border-emerald-500/30 bg-emerald-500/[0.045]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              {t('account.mcp.secretTitle')}
            </CardTitle>
            <CardDescription>{t('account.mcp.secretDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input readOnly value={secret} className="font-mono text-xs" />
              <Button type="button" variant="outline" onClick={() => void copySecret()}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? t('common.copied') : t('common.copy')}
              </Button>
            </div>
            <p className="text-xs text-[var(--color-app-muted)]">
              {t('account.mcp.endpoint', { url: endpoint })}
            </p>
            <Button type="button" size="sm" variant="ghost" onClick={() => setSecret(null)}>
              {t('common.close')}
            </Button>
          </CardContent>
        </Card>
      )}

      {status?.allowCreate ? (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          <Card>
            <CardHeader>
              <CardTitle className="font-display">{t('account.mcp.createTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="mcp-token-label">{t('account.mcp.label')}</Label>
                <Input
                  id="mcp-token-label"
                  value={label}
                  maxLength={100}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder={t('account.mcp.labelPlaceholder')}
                />
              </div>
              <div className="flex items-center justify-between gap-4 rounded-lg border border-[var(--color-app-border)] p-3">
                <div>
                  <Label htmlFor="mcp-write-access">{t('account.mcp.writeAccess')}</Label>
                  <p className="mt-1 text-xs text-[var(--color-app-muted)]">
                    {t('account.mcp.writeAccessHint')}
                  </p>
                </div>
                <Switch
                  id="mcp-write-access"
                  checked={writeAccess}
                  onCheckedChange={setWriteAccess}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mcp-token-expiry">{t('account.mcp.expiresAt')}</Label>
                <Input
                  id="mcp-token-expiry"
                  type="datetime-local"
                  value={expiresAt}
                  min={new Date().toISOString().slice(0, 16)}
                  onChange={(event) => setExpiresAt(event.target.value)}
                />
                <p className="text-[11px] text-[var(--color-app-muted)]">
                  {expiresAt
                    ? formatDate(new Date(expiresAt).toISOString())
                    : t('account.mcp.noExpiry')}
                </p>
              </div>
              <Button
                type="button"
                variant="primary"
                disabled={!label.trim() || creating}
                onClick={() => void createToken()}
              >
                {creating ? <Spinner /> : <KeyRound className="h-4 w-4" />}
                {t('account.mcp.create')}
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      ) : status ? (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-sm text-amber-200">
          {t('account.mcp.policyDisabled')}
        </div>
      ) : null}

      <Card elevated>
        <CardHeader>
          <CardTitle className="font-display">{t('account.mcp.cardTitle')}</CardTitle>
          <CardDescription>{t('account.mcp.cardDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {status === null ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : status.tokens.length === 0 ? (
            <p className="py-4 text-sm text-[var(--color-app-muted)]">{t('account.mcp.empty')}</p>
          ) : (
            status.tokens.map((token) => {
              const state = tokenState(token);
              const stateLabel =
                state === 'active'
                  ? 'account.mcp.statusActive'
                  : state === 'expired'
                    ? 'account.mcp.statusExpired'
                    : 'account.mcp.statusRevoked';
              return (
                <div
                  key={token.id}
                  className="flex items-center gap-3 rounded-lg border border-[var(--color-app-border)] px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium text-[var(--color-app-fg)]">
                        {token.label}
                      </p>
                      <Badge variant={state === 'active' ? 'success' : 'outline'}>
                        {t(stateLabel)}
                      </Badge>
                      <Badge variant="outline">{token.scopes.join(' + ')}</Badge>
                    </div>
                    <p className="mt-1 text-[11px] text-[var(--color-app-muted)]">
                      {token.lastUsedAt
                        ? t('account.mcp.lastUsed', { date: formatDate(token.lastUsedAt) })
                        : t('account.mcp.neverUsed')}
                    </p>
                  </div>
                  {state === 'active' && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setRevokeTarget(token)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {t('account.mcp.revoke')}
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title={t('account.mcp.revokeTitle')}
        description={t('account.mcp.revokeDescription')}
        confirmLabel={t('account.mcp.revoke')}
        variant="destructive"
        onConfirm={async () => {
          const target = revokeTarget;
          setRevokeTarget(null);
          if (target) await revokeToken(target);
        }}
      />
    </PageShell>
  );
}
