import { useEffect, useState } from 'react';
import {
  Check,
  Globe2,
  Lock,
  ShieldCheck,
  ShieldX,
  Trash2,
  Users as UsersIcon,
  X,
} from '@/components/ui/icons';
import { toast } from '@/lib/toast';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { FetchError } from '../components/ui/fetch-error';
import { Skeleton } from '../components/ui/skeleton';
import { Badge } from '../components/ui/badge';
import { Spinner } from '../components/ui/spinner';
import { Switch } from '../components/ui/switch';
import { ApiError, apiGet, apiPost, api } from '../lib/api';
import { useFetch } from '../lib/hooks';
import type { AdminUser } from '../lib/types';
import { formatRelative } from '../lib/format';
import { PageHeader, PageShell } from '../components/ui/page-shell';
import { useI18n, type TranslateFn } from '../lib/i18n';
import { TimezoneSelect } from '../components/timezone-select';
import { DataSurface } from '../components/ui/data-surface';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';

interface InstanceResponse {
  allowSignups: boolean;
  timezone: string;
}

export function AdminUsuariosPage(): React.ReactElement {
  const { data, loading, error, refresh } = useFetch<{ users: AdminUser[] }>('/api/admin/usuarios');
  const { locale, t } = useI18n();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [allowSignups, setAllowSignups] = useState<boolean | null>(null);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [togglingSignups, setTogglingSignups] = useState(false);
  const [savingTimezone, setSavingTimezone] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<AdminUser | null>(null);
  const [deleteEmail, setDeleteEmail] = useState('');

  useEffect(() => {
    // Guarda contra setState após unmount (apiGet não aceita AbortController).
    let cancelled = false;
    apiGet<InstanceResponse>('/api/admin/instance')
      .then((s) => {
        if (cancelled) return;
        setAllowSignups(s.allowSignups);
        setTimezone(s.timezone);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function approve(id: string): Promise<void> {
    setPendingId(id);
    try {
      await apiPost(`/api/admin/usuarios/${id}/approve`, {});
      toast.success(t('admin.users.approvedToast'));
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('admin.users.approveError'));
    } finally {
      setPendingId(null);
    }
  }

  async function reject(id: string): Promise<void> {
    setPendingId(id);
    try {
      await apiPost(`/api/admin/usuarios/${id}/reject`, {});
      toast(t('admin.users.rejectedToast'), { description: t('admin.users.rejectedDescription') });
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('admin.users.rejectError'));
    } finally {
      setPendingId(null);
    }
  }

  async function changeUser(id: string, action: 'disable' | 'enable'): Promise<void> {
    setPendingId(id);
    try {
      await apiPost(`/api/admin/usuarios/${id}/${action}`, {});
      toast.success(action === 'disable' ? 'Usuário bloqueado.' : 'Usuário reativado.');
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Não foi possível atualizar o usuário.');
    } finally {
      setPendingId(null);
    }
  }

  async function toggleAdmin(user: AdminUser): Promise<void> {
    const role = user.role === 'ADMIN' ? 'USER' : 'ADMIN';
    setPendingId(user.id);
    try {
      await api(`/api/admin/usuarios/${user.id}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      toast.success(
        role === 'ADMIN' ? 'Administrador definido.' : 'Acesso administrativo removido.',
      );
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Não foi possível atualizar o papel.');
    } finally {
      setPendingId(null);
    }
  }

  async function deleteUser(): Promise<void> {
    if (!deleteCandidate) return;
    setPendingId(deleteCandidate.id);
    try {
      await api(`/api/admin/usuarios/${deleteCandidate.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ confirmEmail: deleteEmail }),
      });
      toast.success('Conta e workspace excluídos.');
      setDeleteCandidate(null);
      setDeleteEmail('');
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Não foi possível excluir o usuário.');
    } finally {
      setPendingId(null);
    }
  }

  async function toggleSignups(next: boolean): Promise<void> {
    const previous = allowSignups;
    setAllowSignups(next);
    setTogglingSignups(true);
    try {
      const res = await api<InstanceResponse>('/api/admin/instance', {
        method: 'PATCH',
        body: JSON.stringify({ allowSignups: next }),
      });
      if (res.timezone) setTimezone(res.timezone);
      toast.success(next ? t('admin.users.signupsOpen') : t('admin.users.signupsClosed'), {
        description: next
          ? t('admin.users.signupsOpenDescription')
          : t('admin.users.signupsClosedDescription'),
      });
    } catch (err) {
      setAllowSignups(previous);
      toast.error(err instanceof ApiError ? err.message : t('admin.users.updateError'));
    } finally {
      setTogglingSignups(false);
    }
  }

  async function saveTimezone(next: string): Promise<void> {
    const previous = timezone;
    setTimezone(next);
    setSavingTimezone(true);
    try {
      const res = await api<InstanceResponse>('/api/admin/instance', {
        method: 'PATCH',
        body: JSON.stringify({ timezone: next }),
      });
      setTimezone(res.timezone);
      toast.success(t('admin.users.timezoneSaved'), {
        description: t('admin.users.timezoneSavedDescription', { timezone: res.timezone }),
      });
    } catch (err) {
      setTimezone(previous);
      toast.error(err instanceof ApiError ? err.message : t('admin.users.updateError'));
    } finally {
      setSavingTimezone(false);
    }
  }

  const users = data?.users ?? [];
  const pending = users.filter((u) => u.status === 'PENDING');
  const others = users.filter((u) => u.status !== 'PENDING');

  return (
    <PageShell width="wide">
      <div data-page-content className="space-y-6 sm:space-y-10">
        <PageHeader
          eyebrow={t('admin.eyebrow')}
          icon={ShieldCheck}
          iconClassName="text-emerald-400"
          title={t('admin.users.title')}
          description={t('admin.users.description')}
        />

        {/* Toggle de cadastros */}
        <Card elevated>
          <CardContent className="pt-5 pb-5 flex items-center gap-4">
            <div
              className={`h-9 w-9 shrink-0 rounded-lg flex items-center justify-center border ${
                allowSignups
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : 'bg-[var(--color-app-surface-hover)] border-[var(--color-app-border)] text-[var(--color-app-muted)]'
              }`}
            >
              {allowSignups ? <UsersIcon className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[var(--color-app-fg)]">
                {t('admin.users.newSignups')}
              </p>
              <p className="text-xs text-[var(--color-app-muted)] mt-0.5 leading-relaxed">
                {allowSignups === null
                  ? t('admin.users.loading')
                  : allowSignups
                    ? t('admin.users.signupOpenCopy')
                    : t('admin.users.signupClosedCopy')}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {togglingSignups && <Spinner className="text-[var(--color-app-muted)]" />}
              <Switch
                checked={allowSignups ?? false}
                onCheckedChange={toggleSignups}
                disabled={allowSignups === null || togglingSignups}
                aria-label={t('admin.users.allowSignups')}
              />
            </div>
          </CardContent>
        </Card>

        {/* Fuso da instância (spec 095) */}
        <Card elevated>
          <CardContent className="pt-5 pb-5 space-y-4">
            <div className="flex items-start gap-4">
              <div className="h-9 w-9 shrink-0 rounded-lg flex items-center justify-center border bg-violet-500/10 border-violet-500/30 text-violet-300">
                <Globe2 className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <p className="text-sm font-medium text-[var(--color-app-fg)]">
                  {t('admin.users.timezoneTitle')}
                </p>
                <p className="text-xs text-[var(--color-app-muted)] leading-relaxed">
                  {t('admin.users.timezoneDescription')}
                </p>
              </div>
              {savingTimezone && <Spinner className="text-[var(--color-app-muted)] shrink-0" />}
            </div>
            {timezone === null ? (
              <p className="text-xs text-[var(--color-app-muted)]">{t('admin.users.loading')}</p>
            ) : (
              <TimezoneSelect
                id="admin-instance-timezone"
                value={timezone}
                onChange={(next) => void saveTimezone(next)}
                disabled={savingTimezone}
                hint={t('admin.users.timezoneHint')}
              />
            )}
          </CardContent>
        </Card>

        <section className="space-y-4">
          <h2 className="text-sm font-semibold tracking-tight text-[var(--color-app-subtle)]">
            {t('admin.users.pendingApproval')}
            {pending.length > 0 && (
              <Badge variant="warning" className="ml-2">
                {pending.length}
              </Badge>
            )}
          </h2>

          {loading && <Skeleton className="h-32 w-full" />}

          {!loading && error && <FetchError message={error} onRetry={refresh} />}

          {!loading && !error && pending.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-sm text-[var(--color-app-muted)]">
                {t('admin.users.noPending')}
              </CardContent>
            </Card>
          )}

          {!loading && pending.length > 0 && (
            <DataSurface>
              <ul className="divide-y divide-[var(--color-app-border)]">
                {pending.map((u) => (
                  <li
                    key={u.id}
                    className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-[var(--color-app-surface-hover)]/50"
                  >
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
                        <span className="font-medium text-[var(--color-app-fg)] break-words">
                          {u.name}
                        </span>
                        <span className="text-sm text-[var(--color-app-muted)] break-all">
                          {u.email}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--color-app-muted)]">
                        {t('admin.users.registered', {
                          time: formatRelative(new Date(u.createdAt), locale),
                        })}
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={pendingId === u.id}
                        onClick={() => reject(u.id)}
                      >
                        {pendingId === u.id ? <Spinner /> : <X className="h-3.5 w-3.5" />}
                        {t('admin.users.reject')}
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={pendingId === u.id}
                        onClick={() => approve(u.id)}
                      >
                        {pendingId === u.id ? <Spinner /> : <Check className="h-3.5 w-3.5" />}
                        {t('admin.users.approve')}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </DataSurface>
          )}
        </section>

        <section className="space-y-4">
          <h2 className="text-sm font-semibold tracking-tight text-[var(--color-app-subtle)]">
            {t('admin.users.allUsers')}
          </h2>

          {!loading && others.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-sm text-[var(--color-app-muted)]">
                {t('admin.users.firstUser')}
              </CardContent>
            </Card>
          )}

          {!loading && others.length > 0 && (
            <DataSurface>
              <ul className="divide-y divide-[var(--color-app-border)]">
                {others.map((u) => (
                  <li
                    key={u.id}
                    className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-[var(--color-app-surface-hover)]/50"
                  >
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap min-w-0">
                        <span className="font-medium text-[var(--color-app-fg)] break-words">
                          {u.name}
                        </span>
                        <span className="text-sm text-[var(--color-app-muted)] break-all">
                          {u.email}
                        </span>
                        {u.role === 'ADMIN' && (
                          <Badge variant="success" className="text-[10px]">
                            Admin
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-[var(--color-app-muted)]">
                        {u.status === 'APPROVED' && u.approvedAt
                          ? t('admin.users.approvedAt', {
                              time: formatRelative(new Date(u.approvedAt), locale),
                            })
                          : u.status === 'REJECTED'
                            ? t('admin.users.rejected')
                            : t('admin.users.disabled')}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
                      <StatusBadge status={u.status} t={t} />
                      {u.status === 'DISABLED' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pendingId === u.id}
                          onClick={() => void changeUser(u.id, 'enable')}
                        >
                          <Check className="h-3.5 w-3.5" /> Reativar
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pendingId === u.id}
                          onClick={() => void changeUser(u.id, 'disable')}
                        >
                          <ShieldX className="h-3.5 w-3.5" /> Bloquear
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pendingId === u.id}
                        onClick={() => void toggleAdmin(u)}
                      >
                        <ShieldCheck className="h-3.5 w-3.5" />
                        {u.role === 'ADMIN' ? 'Remover admin' : 'Tornar admin'}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={pendingId === u.id}
                        onClick={() => {
                          setDeleteCandidate(u);
                          setDeleteEmail('');
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Excluir
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </DataSurface>
          )}
        </section>

        <Dialog
          open={deleteCandidate !== null}
          onOpenChange={(open) => {
            if (!open && pendingId !== deleteCandidate?.id) {
              setDeleteCandidate(null);
              setDeleteEmail('');
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Excluir conta definitivamente?</DialogTitle>
              <DialogDescription>
                Isso remove a conta, sessões, credenciais pessoais e todo o workspace. Digite
                exatamente <strong>{deleteCandidate?.email}</strong> para confirmar.
              </DialogDescription>
            </DialogHeader>
            <Input
              value={deleteEmail}
              onChange={(event) => setDeleteEmail(event.target.value)}
              placeholder={deleteCandidate?.email ?? 'email@exemplo.com'}
              autoComplete="off"
              aria-label="E-mail de confirmação da exclusão"
            />
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setDeleteCandidate(null);
                  setDeleteEmail('');
                }}
                disabled={pendingId === deleteCandidate?.id}
              >
                Cancelar
              </Button>
              <Button
                variant="destructive"
                onClick={() => void deleteUser()}
                disabled={
                  !deleteCandidate ||
                  deleteEmail !== deleteCandidate.email ||
                  pendingId === deleteCandidate.id
                }
              >
                {pendingId === deleteCandidate?.id && <Spinner />}
                Excluir definitivamente
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </PageShell>
  );
}

function StatusBadge({
  status,
  t,
}: {
  status: AdminUser['status'];
  t: TranslateFn;
}): React.ReactElement {
  if (status === 'APPROVED') {
    return <Badge variant="success">{t('admin.users.status.active')}</Badge>;
  }
  if (status === 'PENDING') {
    return <Badge variant="warning">{t('admin.users.status.pending')}</Badge>;
  }
  if (status === 'REJECTED') {
    return <Badge variant="danger">{t('admin.users.status.rejected')}</Badge>;
  }
  return <Badge variant="muted">{t('admin.users.status.disabled')}</Badge>;
}
