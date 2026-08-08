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
import { nextLocalDateTimeInputMin } from '../lib/local-datetime';
import { AccountPageNav } from '../components/account/account-page-nav';
import { McpClientSetup } from '../components/account/mcp-client-setup';

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

interface OAuthGrant {
  id: string;
  clientId: string;
  clientName: string;
  clientUri: string | null;
  disabled: boolean;
  redirectHosts: string[];
  scopes: string[];
  createdAt: string | null;
  updatedAt: string | null;
}

interface OAuthGrantStatus {
  enabled: boolean;
  grants: OAuthGrant[];
}

export function ContaMcpPage(): React.ReactElement {
  const { t, locale } = useI18n();
  const [status, setStatus] = useState<PersonalMcpStatus | null>(null);
  const [oauthStatus, setOAuthStatus] = useState<OAuthGrantStatus | null>(null);
  const [label, setLabel] = useState('');
  const [writeAccess, setWriteAccess] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<PersonalMcpToken | null>(null);
  const [oauthRevokeTarget, setOAuthRevokeTarget] = useState<OAuthGrant | null>(null);
  const endpoint = useMemo(() => `${window.location.origin}/mcp`, []);
  const minExpiry = useMemo(() => nextLocalDateTimeInputMin(new Date()), []);

  async function refresh(): Promise<void> {
    try {
      const [personal, oauth] = await Promise.all([
        apiGet<PersonalMcpStatus>('/api/mcp/tokens'),
        apiGet<OAuthGrantStatus>('/api/mcp/oauth'),
      ]);
      setStatus(personal);
      setOAuthStatus(oauth);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('common.error'));
      setStatus({ tokens: [], allowCreate: false });
      setOAuthStatus({ enabled: false, grants: [] });
    }
  }

  async function revokeOAuthGrant(grant: OAuthGrant): Promise<void> {
    try {
      await apiDelete(`/api/mcp/oauth/grants/${grant.id}`);
      toast.success(locale === 'en' ? 'OAuth access revoked.' : 'Acesso OAuth revogado.');
      await refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('common.error'));
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
    <PageShell width="wide">
      <PageHeader
        eyebrow={t('account.eyebrow')}
        icon={KeyRound}
        iconClassName="text-emerald-400"
        title={t('account.mcp.title')}
        description={t('account.mcp.description')}
      />

      <AccountPageNav />

      <McpClientSetup
        locale={locale}
        endpoint={endpoint}
        visibleToken={secret}
        onCopyError={() => toast.error(t('admin.integrations.copyError'))}
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
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input readOnly value={secret} className="min-w-0 font-mono text-xs" />
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => void copySecret()}
              >
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
                  min={minExpiry}
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

      <Card elevated>
        <CardHeader>
          <CardTitle className="font-display">
            {locale === 'en' ? 'Connected OAuth clients' : 'Clientes OAuth conectados'}
          </CardTitle>
          <CardDescription>
            {locale === 'en'
              ? 'Applications authorized through OAuth 2.1. Revocation is immediate and does not affect personal tokens.'
              : 'Aplicações autorizadas por OAuth 2.1. A revogação é imediata e não afeta tokens pessoais.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {oauthStatus === null ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : !oauthStatus.enabled ? (
            <p className="py-3 text-sm text-[var(--color-app-muted)]">
              {locale === 'en'
                ? 'OAuth MCP is disabled by the instance administrator.'
                : 'O OAuth MCP está desativado pelo administrador da instância.'}
            </p>
          ) : oauthStatus.grants.length === 0 ? (
            <p className="py-3 text-sm text-[var(--color-app-muted)]">
              {locale === 'en'
                ? 'No application has OAuth access to your workspace.'
                : 'Nenhuma aplicação possui acesso OAuth ao seu workspace.'}
            </p>
          ) : (
            oauthStatus.grants.map((grant) => (
              <div
                key={grant.id}
                className="flex items-center gap-3 rounded-lg border border-[var(--color-app-border)] px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-[var(--color-app-fg)]">
                      {grant.clientName}
                    </p>
                    <Badge variant={grant.disabled ? 'outline' : 'success'}>
                      {grant.scopes.join(' + ')}
                    </Badge>
                  </div>
                  <p className="mt-1 truncate text-[11px] text-[var(--color-app-muted)]">
                    {grant.redirectHosts.join(', ') || grant.clientId}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setOAuthRevokeTarget(grant)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {locale === 'en' ? 'Revoke' : 'Revogar'}
                </Button>
              </div>
            ))
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
      <ConfirmDialog
        open={oauthRevokeTarget !== null}
        onOpenChange={(open) => !open && setOAuthRevokeTarget(null)}
        title={locale === 'en' ? 'Revoke OAuth access?' : 'Revogar acesso OAuth?'}
        description={
          locale === 'en'
            ? 'The client will lose access immediately and must request authorization again.'
            : 'O cliente perderá o acesso imediatamente e precisará solicitar nova autorização.'
        }
        confirmLabel={locale === 'en' ? 'Revoke' : 'Revogar'}
        variant="destructive"
        onConfirm={async () => {
          const target = oauthRevokeTarget;
          setOAuthRevokeTarget(null);
          if (target) await revokeOAuthGrant(target);
        }}
      />
    </PageShell>
  );
}
