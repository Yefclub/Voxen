import { useEffect, useState } from 'react';
import { Check, Lock, ShieldCheck, Users as UsersIcon, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';
import { Badge } from '../components/ui/badge';
import { Spinner } from '../components/ui/spinner';
import { Switch } from '../components/ui/switch';
import { ApiError, apiGet, apiPost, api } from '../lib/api';
import { useFetch } from '../lib/hooks';
import type { AdminUser } from '../lib/types';
import { formatRelative } from '../lib/format';
import { AnimatedPage } from '../components/motion/animated-page';
import { useI18n, type TranslateFn } from '../lib/i18n';

interface InstanceResponse {
  allowSignups: boolean;
}

export function AdminUsuariosPage(): React.ReactElement {
  const { data, loading, refresh } = useFetch<{ users: AdminUser[] }>('/api/admin/usuarios');
  const { locale, t } = useI18n();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [allowSignups, setAllowSignups] = useState<boolean | null>(null);
  const [togglingSignups, setTogglingSignups] = useState(false);

  useEffect(() => {
    // Guarda contra setState após unmount (apiGet não aceita AbortController).
    let cancelled = false;
    apiGet<InstanceResponse>('/api/admin/instance')
      .then((s) => {
        if (cancelled) return;
        setAllowSignups(s.allowSignups);
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

  async function toggleSignups(next: boolean): Promise<void> {
    const previous = allowSignups;
    setAllowSignups(next);
    setTogglingSignups(true);
    try {
      await api<InstanceResponse>('/api/admin/instance', {
        method: 'PATCH',
        body: JSON.stringify({ allowSignups: next }),
      });
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

  const users = data?.users ?? [];
  const pending = users.filter((u) => u.status === 'PENDING');
  const others = users.filter((u) => u.status !== 'PENDING');

  return (
    <AnimatedPage>
      <div className="px-8 py-12 mx-auto max-w-6xl space-y-10">
        <header className="space-y-3">
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--color-app-muted)] font-medium">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            {t('admin.eyebrow')}
          </div>
          <h1 className="font-display text-4xl font-semibold tracking-[-0.03em]">
            {t('admin.users.title')}
          </h1>
          <p className="text-[15px] text-[var(--color-app-muted)] leading-relaxed max-w-2xl">
            {t('admin.users.description')}
          </p>
        </header>

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
              <p className="text-sm font-medium text-zinc-100">{t('admin.users.newSignups')}</p>
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

        <section className="space-y-4">
          <h2 className="text-sm font-semibold tracking-tight text-zinc-300">
            {t('admin.users.pendingApproval')}
            {pending.length > 0 && (
              <Badge variant="warning" className="ml-2">
                {pending.length}
              </Badge>
            )}
          </h2>

          {loading && <Skeleton className="h-32 w-full" />}

          {!loading && pending.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-sm text-[var(--color-app-muted)]">
                {t('admin.users.noPending')}
              </CardContent>
            </Card>
          )}

          {!loading && pending.length > 0 && (
            <Card>
              <ul className="divide-y divide-[var(--color-app-border)]">
                {pending.map((u) => (
                  <li
                    key={u.id}
                    className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-[var(--color-app-surface-hover)]/50"
                  >
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-3">
                        <span className="font-medium text-zinc-100">{u.name}</span>
                        <span className="text-sm text-[var(--color-app-muted)]">{u.email}</span>
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
            </Card>
          )}
        </section>

        <section className="space-y-4">
          <h2 className="text-sm font-semibold tracking-tight text-zinc-300">
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
            <Card>
              <ul className="divide-y divide-[var(--color-app-border)]">
                {others.map((u) => (
                  <li
                    key={u.id}
                    className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-[var(--color-app-surface-hover)]/50"
                  >
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="font-medium text-zinc-100">{u.name}</span>
                        <span className="text-sm text-[var(--color-app-muted)]">{u.email}</span>
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
                    <StatusBadge status={u.status} t={t} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>
      </div>
    </AnimatedPage>
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
