import { useEffect, useState } from 'react';
import { Check, Copy, KeyRound, RotateCw, ShieldCheck, Trash2 } from '@/components/ui/icons';
import { toast } from '@/lib/toast';
import { ApiError, api, apiGet, apiPost } from '../lib/api';
import { useI18n } from '../lib/i18n';
import {
  EMPTY_PROVIDER_FORM,
  ProviderFields,
  providerPayload,
  type ProviderForm,
} from '../components/admin/admin-authentication-form';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { PageHeader, PageShell } from '../components/ui/page-shell';
import { Spinner } from '../components/ui/spinner';

interface OidcProvider {
  id: string;
  providerId: string;
  issuer: string;
  domains: string[];
  domainVerified: boolean;
  clientIdLastFour: string;
  secretConfigured: boolean;
  scopes: string[];
  callbackUrl: string;
  configurationError: boolean;
  createdAt: string;
  updatedAt: string;
}

interface DnsRecord {
  name: string;
  type: 'TXT';
  value: string;
}

export function AdminAutenticacaoPage(): React.ReactElement {
  const { t } = useI18n();
  const [providers, setProviders] = useState<OidcProvider[] | null>(null);
  const [form, setForm] = useState<ProviderForm>(EMPTY_PROVIDER_FORM);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<OidcProvider | null>(null);
  const [deleting, setDeleting] = useState<OidcProvider | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [dnsRecords, setDnsRecords] = useState<Record<string, DnsRecord[]>>({});

  async function refresh(): Promise<void> {
    try {
      const response = await apiGet<{ providers: OidcProvider[] }>(
        '/api/admin/authentication/providers',
      );
      setProviders(response.providers);
    } catch (error) {
      setProviders([]);
      toast.error(error instanceof ApiError ? error.message : t('admin.auth.loadError'));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  function setField<K extends keyof ProviderForm>(field: K, value: ProviderForm[K]): void {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function createProvider(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    try {
      await apiPost('/api/admin/authentication/providers', providerPayload(form, false));
      toast.success(t('admin.auth.created'));
      setForm(EMPTY_PROVIDER_FORM);
      await refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('admin.auth.saveError'));
    } finally {
      setSaving(false);
    }
  }

  function openEdit(provider: OidcProvider): void {
    setEditing(provider);
    setForm({
      providerId: provider.providerId,
      issuer: provider.issuer,
      domains: provider.domains.join(', '),
      clientId: '',
      clientSecret: '',
      scopes: provider.scopes.join(' '),
    });
  }

  function closeEdit(): void {
    setEditing(null);
    setForm(EMPTY_PROVIDER_FORM);
  }

  async function updateProvider(): Promise<void> {
    if (!editing) return;
    setSaving(true);
    try {
      await api(`/api/admin/authentication/providers/${encodeURIComponent(editing.providerId)}`, {
        method: 'PATCH',
        body: JSON.stringify(providerPayload(form, true)),
      });
      toast.success(t('admin.auth.updated'));
      closeEdit();
      await refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('admin.auth.saveError'));
    } finally {
      setSaving(false);
    }
  }

  async function removeProvider(): Promise<void> {
    if (!deleting) return;
    setPendingId(deleting.providerId);
    try {
      await api(`/api/admin/authentication/providers/${encodeURIComponent(deleting.providerId)}`, {
        method: 'DELETE',
      });
      toast.success(t('admin.auth.deleted'));
      setDeleting(null);
      await refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('admin.auth.deleteError'));
    } finally {
      setPendingId(null);
    }
  }

  async function requestVerification(provider: OidcProvider): Promise<void> {
    setPendingId(provider.providerId);
    try {
      const response = await apiPost<{ records: DnsRecord[] }>(
        `/api/admin/authentication/providers/${encodeURIComponent(provider.providerId)}/domain-verification/request`,
        {},
      );
      setDnsRecords((current) => ({ ...current, [provider.providerId]: response.records }));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('admin.auth.verifyError'));
    } finally {
      setPendingId(null);
    }
  }

  async function verify(provider: OidcProvider): Promise<void> {
    setPendingId(provider.providerId);
    try {
      await apiPost(
        `/api/admin/authentication/providers/${encodeURIComponent(provider.providerId)}/domain-verification/verify`,
        {},
      );
      toast.success(t('admin.auth.verified'));
      setDnsRecords((current) => {
        const next = { ...current };
        delete next[provider.providerId];
        return next;
      });
      await refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('admin.auth.verifyError'));
    } finally {
      setPendingId(null);
    }
  }

  async function copy(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t('common.copied'));
    } catch {
      toast.error(t('admin.auth.copyError'));
    }
  }

  return (
    <PageShell width="workspace">
      <div data-page-content className="space-y-8 sm:space-y-10">
        <PageHeader
          eyebrow={t('admin.eyebrow')}
          icon={KeyRound}
          iconClassName="text-violet-400"
          title={t('admin.auth.title')}
          description={t('admin.auth.description')}
        />

        <Card elevated>
          <CardHeader>
            <CardTitle>{t('admin.auth.newProvider')}</CardTitle>
            <CardDescription>{t('admin.auth.newProviderDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={(event) => void createProvider(event)}>
              <ProviderFields form={form} setField={setField} disabled={saving} showProviderId />
              <Button className="mt-5" type="submit" disabled={saving}>
                {saving ? <Spinner /> : <KeyRound className="h-4 w-4" />}
                {t('admin.auth.create')}
              </Button>
            </form>
          </CardContent>
        </Card>

        <section className="space-y-3">
          <div>
            <h2 className="font-display text-lg font-semibold">{t('admin.auth.providers')}</h2>
            <p className="text-sm text-[var(--color-app-muted)]">
              {t('admin.auth.providersDescription')}
            </p>
          </div>
          {providers === null ? (
            <Card>
              <CardContent className="py-6">
                <Spinner />
              </CardContent>
            </Card>
          ) : providers.length === 0 ? (
            <Card>
              <CardContent className="py-6 text-sm text-[var(--color-app-muted)]">
                {t('admin.auth.empty')}
              </CardContent>
            </Card>
          ) : (
            providers.map((provider) => {
              const records = dnsRecords[provider.providerId] ?? [];
              const busy = pendingId === provider.providerId;
              return (
                <Card key={provider.id} elevated>
                  <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <CardTitle className="flex items-center gap-2">
                          <ShieldCheck className="h-4 w-4 text-violet-400" />
                          {provider.providerId}
                          <Badge
                            variant={
                              provider.domainVerified && !provider.configurationError
                                ? 'success'
                                : 'warning'
                            }
                          >
                            {provider.configurationError
                              ? t('admin.auth.statusConfigurationError')
                              : provider.domainVerified
                                ? t('admin.auth.statusVerified')
                                : t('admin.auth.statusPending')}
                          </Badge>
                        </CardTitle>
                        <CardDescription className="mt-1">{provider.issuer}</CardDescription>
                      </div>
                      <div className="flex gap-2">
                        {!provider.configurationError && (
                          <Button variant="ghost" size="sm" onClick={() => openEdit(provider)}>
                            {t('admin.auth.edit')}
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => setDeleting(provider)}>
                          <Trash2 className="h-3.5 w-3.5" />
                          {t('common.delete')}
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4 text-sm">
                    {provider.configurationError && (
                      <div className="rounded-xl border border-red-500/25 bg-red-500/[0.06] p-4 text-sm text-red-300">
                        {t('admin.auth.configurationError')}
                      </div>
                    )}
                    <dl className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <dt className="text-xs text-[var(--color-app-muted)]">
                          {t('admin.auth.domains')}
                        </dt>
                        <dd>{provider.domains.join(', ')}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-[var(--color-app-muted)]">
                          {t('admin.auth.client')}
                        </dt>
                        <dd className="font-mono">
                          {provider.clientIdLastFour ? `••••${provider.clientIdLastFour}` : '—'}
                        </dd>
                      </div>
                    </dl>
                    <div>
                      <Label>{t('admin.auth.callback')}</Label>
                      <div className="mt-1 flex gap-2">
                        <Input
                          readOnly
                          value={provider.callbackUrl}
                          className="font-mono text-xs"
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => void copy(provider.callbackUrl)}
                          aria-label={t('common.copy')}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    {!provider.domainVerified && !provider.configurationError && (
                      <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-4 space-y-3">
                        <p className="text-xs text-[var(--color-app-muted)]">
                          {t('admin.auth.dnsDescription')}
                        </p>
                        {records.map((record) => (
                          <div key={record.name} className="space-y-1 font-mono text-xs">
                            <div>
                              {record.type} {record.name}
                            </div>
                            <div className="flex gap-2">
                              <Input readOnly value={record.value} className="font-mono text-xs" />
                              <Button
                                variant="outline"
                                size="icon"
                                onClick={() => void copy(record.value)}
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => void requestVerification(provider)}
                          >
                            {busy ? <Spinner /> : <RotateCw className="h-3.5 w-3.5" />}
                            {t('admin.auth.requestDns')}
                          </Button>
                          {records.length > 0 && (
                            <Button size="sm" disabled={busy} onClick={() => void verify(provider)}>
                              <Check className="h-3.5 w-3.5" /> {t('admin.auth.verifyDns')}
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
        </section>
      </div>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && closeEdit()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.auth.editTitle')}</DialogTitle>
            <DialogDescription>{t('admin.auth.editDescription')}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              void updateProvider();
            }}
          >
            <ProviderFields
              form={form}
              setField={setField}
              disabled={saving}
              showProviderId={false}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeEdit}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Spinner /> : t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('admin.auth.deleteTitle')}
        description={t('admin.auth.deleteDescription')}
        confirmLabel={t('common.delete')}
        onConfirm={removeProvider}
        loading={deleting ? pendingId === deleting.providerId : false}
      />
    </PageShell>
  );
}
