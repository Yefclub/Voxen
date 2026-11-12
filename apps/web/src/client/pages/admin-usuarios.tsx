import { useEffect, useState } from 'react';
import { Check, ShieldCheck, ShieldX, Trash2, X } from '@/components/ui/icons';
import { toast } from '@/lib/toast';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { FetchError } from '../components/ui/fetch-error';
import { Skeleton } from '../components/ui/skeleton';
import { Badge } from '../components/ui/badge';
import { Spinner } from '../components/ui/spinner';
import { ApiError, apiPost, api } from '../lib/api';
import { useFetch } from '../lib/hooks';
import type { AdminUser } from '../lib/types';
import { formatRelative } from '../lib/format';
import { PageHeader, PageShell } from '../components/ui/page-shell';
import { useI18n, type TranslateFn } from '../lib/i18n';
import { InstanceAccessSettings } from '../components/admin/instance-access-settings';
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
  const {
    data: instance,
    error: instanceError,
    loading: instanceLoading,
    refresh: refreshInstance,
  } = useFetch<InstanceResponse>('/api/admin/instance');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [allowSignups, setAllowSignups] = useState<boolean | null>(null);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [togglingSignups, setTogglingSignups] = useState(false);
  const [savingTimezone, setSavingTimezone] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<AdminUser | null>(null);
  const [deleteEmail, setDeleteEmail] = useState('');

  useEffect(() => {
    if (!instance) return;
    setAllowSignups(instance.allowSignups);
    setTimezone(instance.timezone);
  }, [instance]);

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
      toast.success(
        action === 'disable'
          ? locale === 'en'
            ? 'User blocked.'
            : 'Usuário bloqueado.'
          : locale === 'en'
            ? 'User reactivated.'
            : 'Usuário reativado.',
      );
      refresh();
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : locale === 'en'
            ? 'Could not update the user.'
            : 'Não foi possível atualizar o usuário.',
      );
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
        role === 'ADMIN'
          ? locale === 'en'
            ? 'Administrator assigned.'
            : 'Administrador definido.'
          : locale === 'en'
            ? 'Administrator access removed.'
            : 'Acesso administrativo removido.',
      );
      refresh();
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : locale === 'en'
            ? 'Could not update the role.'
            : 'Não foi possível atualizar o papel.',
      );
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
      toast.success(
        locale === 'en' ? 'Account and workspace deleted.' : 'Conta e workspace excluídos.',
      );
      setDeleteCandidate(null);
      setDeleteEmail('');
      refresh();
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : locale === 'en'
            ? 'Could not delete the user.'
            : 'Não foi possível excluir o usuário.',
      );
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
        <PageHeader title={t('admin.users.title')} description={t('admin.users.description')} />

        {instanceError ? (
          <FetchError
            message={instanceError}
            onRetry={refreshInstance}
            retrying={instanceLoading}
          />
        ) : (
          <InstanceAccessSettings
            allowSignups={allowSignups}
            timezone={timezone}
            togglingSignups={togglingSignups}
            savingTimezone={savingTimezone}
            onSignupsChange={toggleSignups}
            onTimezoneChange={saveTimezone}
          />
        )}

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
                    className="flex flex-col items-stretch gap-4 px-5 py-4 transition-colors sm:flex-row sm:items-center hover:bg-[var(--color-app-surface-hover)]/50"
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
                    <div className="flex flex-wrap gap-2 shrink-0">
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
                    className="flex flex-col items-stretch gap-4 px-5 py-4 transition-colors sm:flex-row sm:items-center hover:bg-[var(--color-app-surface-hover)]/50"
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
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end sm:max-w-[55%] shrink-0">
                      <StatusBadge status={u.status} t={t} />
                      {u.status === 'DISABLED' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pendingId === u.id}
                          onClick={() => void changeUser(u.id, 'enable')}
                        >
                          <Check className="h-3.5 w-3.5" />{' '}
                          {locale === 'en' ? 'Reactivate' : 'Reativar'}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pendingId === u.id}
                          onClick={() => void changeUser(u.id, 'disable')}
                        >
                          <ShieldX className="h-3.5 w-3.5" />{' '}
                          {locale === 'en' ? 'Block' : 'Bloquear'}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pendingId === u.id}
                        onClick={() => void toggleAdmin(u)}
                      >
                        <ShieldCheck className="h-3.5 w-3.5" />
                        {u.role === 'ADMIN'
                          ? locale === 'en'
                            ? 'Remove admin'
                            : 'Remover admin'
                          : locale === 'en'
                            ? 'Make admin'
                            : 'Tornar admin'}
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
                        <Trash2 className="h-3.5 w-3.5" /> {t('common.delete')}
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
              <DialogTitle>
                {locale === 'en' ? 'Permanently delete account?' : 'Excluir conta definitivamente?'}
              </DialogTitle>
              <DialogDescription>
                {locale === 'en'
                  ? 'This removes the account, sessions, personal credentials and the entire workspace. Type exactly '
                  : 'Isso remove a conta, sessões, credenciais pessoais e todo o workspace. Digite exatamente '}
                <strong>{deleteCandidate?.email}</strong>
                {locale === 'en' ? ' to confirm.' : ' para confirmar.'}
              </DialogDescription>
            </DialogHeader>
            <Input
              value={deleteEmail}
              onChange={(event) => setDeleteEmail(event.target.value)}
              placeholder={deleteCandidate?.email ?? 'email@exemplo.com'}
              autoComplete="off"
              aria-label={
                locale === 'en'
                  ? 'Deletion confirmation email'
                  : 'E-mail de confirmação da exclusão'
              }
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
                {t('common.cancel')}
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
                {locale === 'en' ? 'Delete permanently' : 'Excluir definitivamente'}
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
