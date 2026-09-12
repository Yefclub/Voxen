import { useState } from 'react';
import { Copy, KeyRound } from '@/components/ui/icons';
import { toast } from '@/lib/toast';
import { ApiError, apiPatch, apiPost } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Spinner } from '../ui/spinner';
import { Switch } from '../ui/switch';

interface OAuthClientSummary {
  clientId: string;
  name: string | null;
  public: boolean | null;
  disabled: boolean | null;
  redirectHosts: string[];
  consentCount: number;
}

interface McpOAuthAdminSectionProps {
  enabled: boolean;
  clients: OAuthClientSummary[];
  onChanged: () => Promise<void>;
}

export function McpOAuthAdminSection({
  enabled,
  clients,
  onChanged,
}: McpOAuthAdminSectionProps): React.ReactElement {
  const { t, locale } = useI18n();
  const [updating, setUpdating] = useState(false);
  const [updatingClient, setUpdatingClient] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [redirectUri, setRedirectUri] = useState('');
  const [confidential, setConfidential] = useState(false);
  const [writeScope, setWriteScope] = useState(false);
  const [creating, setCreating] = useState(false);
  const [credentials, setCredentials] = useState<{
    clientId: string;
    clientSecret?: string;
  } | null>(null);

  async function toggleOAuth(nextEnabled: boolean): Promise<void> {
    setUpdating(true);
    try {
      await apiPatch('/api/admin/mcp', { oauthEnabled: nextEnabled });
      await onChanged();
      toast.success(
        nextEnabled
          ? locale === 'en'
            ? 'MCP OAuth 2.1 enabled.'
            : 'OAuth 2.1 do MCP habilitado.'
          : locale === 'en'
            ? 'MCP OAuth 2.1 disabled.'
            : 'OAuth 2.1 do MCP desabilitado.',
      );
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('common.error'));
    } finally {
      setUpdating(false);
    }
  }

  async function toggleClient(clientId: string, disabled: boolean): Promise<void> {
    setUpdatingClient(clientId);
    try {
      await apiPatch(`/api/admin/mcp/oauth/clients/${encodeURIComponent(clientId)}`, { disabled });
      await onChanged();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('common.error'));
    } finally {
      setUpdatingClient(null);
    }
  }

  async function createClient(): Promise<void> {
    if (!name.trim() || !redirectUri.trim() || creating) return;
    setCreating(true);
    try {
      const created = await apiPost<{ clientId: string; clientSecret?: string }>(
        '/api/admin/mcp/oauth/clients',
        {
          name: name.trim(),
          redirectUris: [redirectUri.trim()],
          confidential,
          scopes: writeScope ? ['mcp:read', 'mcp:write'] : ['mcp:read'],
        },
      );
      setCredentials(created);
      setName('');
      setRedirectUri('');
      setConfidential(false);
      setWriteScope(false);
      await onChanged();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('common.error'));
    } finally {
      setCreating(false);
    }
  }

  async function copyCredentials(): Promise<void> {
    if (!credentials) return;
    const value = `Client ID: ${credentials.clientId}${credentials.clientSecret ? `\nClient secret: ${credentials.clientSecret}` : ''}`;
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t('common.copied'));
    } catch {
      toast.error(t('admin.integrations.copyError'));
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-[var(--color-app-border)] px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-[var(--color-app-fg)]">OAuth 2.1 + PKCE</p>
          <p className="text-xs text-[var(--color-app-muted)]">
            {locale === 'en'
              ? 'Enables discovery, dynamic registration, consent, and refresh for MCP clients.'
              : 'Habilita descoberta, registro dinâmico, consentimento e refresh para clientes MCP.'}
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(value) => void toggleOAuth(value)}
          disabled={updating}
          aria-label="OAuth 2.1 MCP"
        />
      </div>

      {enabled && (
        <div className="space-y-3 border-t border-[var(--color-app-border)] pt-3">
          <div>
            <p className="text-sm font-medium text-[var(--color-app-fg)]">
              {locale === 'en' ? 'Pre-register an OAuth client' : 'Pré-registrar cliente OAuth'}
            </p>
            <p className="text-xs text-[var(--color-app-muted)]">
              {locale === 'en'
                ? 'Use the exact callback URI supplied by clients that cannot register dynamically.'
                : 'Use a callback URI exata fornecida por clientes sem registro dinâmico.'}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="mcp-oauth-client-name">
                {locale === 'en' ? 'Client name' : 'Nome do cliente'}
              </Label>
              <Input
                id="mcp-oauth-client-name"
                value={name}
                maxLength={100}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mcp-oauth-redirect">Redirect URI</Label>
              <Input
                id="mcp-oauth-redirect"
                value={redirectUri}
                onChange={(event) => setRedirectUri(event.target.value)}
                placeholder="https://client.example/callback"
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-app-border)] p-3">
              <Label htmlFor="mcp-oauth-confidential">
                {locale === 'en' ? 'Confidential client' : 'Cliente confidencial'}
              </Label>
              <Switch
                id="mcp-oauth-confidential"
                checked={confidential}
                onCheckedChange={setConfidential}
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-app-border)] p-3">
              <Label htmlFor="mcp-oauth-write">mcp:write</Label>
              <Switch id="mcp-oauth-write" checked={writeScope} onCheckedChange={setWriteScope} />
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={!name.trim() || !redirectUri.trim() || creating}
            onClick={() => void createClient()}
          >
            {creating ? <Spinner /> : <KeyRound className="h-4 w-4" />}
            {locale === 'en' ? 'Create client' : 'Criar cliente'}
          </Button>
          {credentials && (
            <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
              <p className="text-xs text-amber-200">
                {locale === 'en'
                  ? 'Copy these credentials now. A secret is shown only once.'
                  : 'Copie as credenciais agora. O secret aparece uma única vez.'}
              </p>
              <code className="block break-all text-xs">Client ID: {credentials.clientId}</code>
              {credentials.clientSecret && (
                <code className="block break-all text-xs">
                  Client secret: {credentials.clientSecret}
                </code>
              )}
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void copyCredentials()}
                >
                  <Copy className="h-3.5 w-3.5" />
                  {t('common.copy')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setCredentials(null)}
                >
                  {t('common.close')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {clients.length > 0 && (
        <div className="divide-y divide-[var(--color-app-border)] border-t border-[var(--color-app-border)] pt-1">
          {clients.map((client) => (
            <div key={client.clientId} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm text-[var(--color-app-fg)]">
                    {client.name || 'OAuth client'}
                  </p>
                  <Badge variant={client.disabled ? 'outline' : 'success'}>
                    {client.public ? 'PUBLIC + PKCE' : 'CONFIDENTIAL'}
                  </Badge>
                </div>
                <p className="truncate text-xs text-[var(--color-app-muted)]">
                  {client.redirectHosts.join(', ') || client.clientId} · {client.consentCount}{' '}
                  {locale === 'en' ? 'consent(s)' : 'consentimento(s)'}
                </p>
              </div>
              <Switch
                checked={!client.disabled}
                onCheckedChange={(value) => void toggleClient(client.clientId, !value)}
                disabled={updatingClient === client.clientId}
                aria-label={`OAuth client ${client.name || client.clientId}`}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
