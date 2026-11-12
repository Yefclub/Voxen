import { useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, Upload } from '@/components/ui/icons';
import { toast } from '@/lib/toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Avatar, AvatarFallback } from '../components/ui/avatar';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Spinner } from '../components/ui/spinner';
import { FetchError } from '../components/ui/fetch-error';
import { ApiError, api, apiGet, apiPost } from '../lib/api';
import { useMe } from '../lib/hooks';
import { PageHeader, PageShell } from '../components/ui/page-shell';
import { formatDateTime } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { AccountPageNav } from '../components/account/account-page-nav';
import { QrLoginCard } from '../components/account/qr-login-card';

interface AccountData {
  id: string;
  email: string;
  name: string;
  image: string | null;
  role: 'ADMIN' | 'USER';
  status: string;
  createdAt: string;
}

export function ContaPage(): React.ReactElement {
  const { refresh } = useMe();
  const { locale, t } = useI18n();
  const [account, setAccount] = useState<AccountData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // Senha
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNew, setConfirmNew] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [changingPwd, setChangingPwd] = useState(false);

  useEffect(() => {
    // Guarda contra setState após unmount: o helper `apiGet` não suporta
    // AbortController, então usamos a flag clássica de cleanup.
    let cancelled = false;
    setLoadError(null);
    apiGet<{ user: AccountData }>('/api/account')
      .then((d) => {
        if (cancelled) return;
        setAccount(d.user);
        setName(d.user.name);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : t('common.error'));
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  async function saveName(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!account || name === account.name) return;
    setSavingName(true);
    try {
      const res = await api<{ user: AccountData }>('/api/account', {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      });
      setAccount((a) => (a ? { ...a, name: res.user.name } : a));
      await refresh();
      toast.success(t('account.nameUpdated'));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('account.saveFailed'));
    } finally {
      setSavingName(false);
    }
  }

  async function uploadAvatar(file: File): Promise<void> {
    setUploadingAvatar(true);
    try {
      const fd = new FormData();
      fd.append('avatar', file);
      const res = await fetch('/api/onboarding/avatar', {
        method: 'POST',
        body: fd,
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? t('account.avatarUploadError'));
      }
      const data = (await res.json()) as { image: string };
      setAccount((a) => (a ? { ...a, image: data.image } : a));
      await refresh();
      toast.success(t('account.avatarUpdated'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('account.avatarUploadFailed'));
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function changePassword(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (newPassword.length < 12) {
      toast.error(t('account.passwordTooShort'));
      return;
    }
    if (newPassword !== confirmNew) {
      toast.error(t('account.passwordMismatch'));
      return;
    }
    setChangingPwd(true);
    try {
      await apiPost('/api/account/password', {
        currentPassword,
        newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNew('');
      toast.success(t('account.passwordChanged'), {
        description: t('account.passwordChangedDescription'),
      });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('account.currentPasswordIncorrect'));
    } finally {
      setChangingPwd(false);
    }
  }

  if (!account) {
    return (
      <PageShell width="wide">
        <PageHeader title={t('account.title')} description={t('account.description')} />
        <AccountPageNav />
        {loadError ? (
          <FetchError message={loadError} onRetry={() => setReload((n) => n + 1)} />
        ) : (
          <div className="flex min-h-64 items-center justify-center">
            <Spinner size={20} />
          </div>
        )}
      </PageShell>
    );
  }

  return (
    <PageShell width="wide">
      <PageHeader title={t('account.title')} description={t('account.description')} />

      <AccountPageNav />

      <div className="grid items-start gap-6 xl:grid-cols-2">
        {/* Identidade */}
        <Card elevated>
          <CardHeader>
            <CardTitle className="font-display text-lg">{t('account.identityTitle')}</CardTitle>
            <CardDescription>{t('account.emailFixed')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={saveName} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">{t('auth.email')}</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={account.email}
                  readOnly
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">{t('auth.name')}</Label>
                <Input
                  id="name"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  minLength={2}
                  required
                />
              </div>
              <div className="flex justify-end">
                <Button
                  type="submit"
                  variant="primary"
                  size="default"
                  disabled={savingName || name === account.name || name.length < 2}
                >
                  {savingName && <Spinner />} {t('common.save')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Avatar */}
        <Card elevated>
          <CardHeader>
            <CardTitle className="font-display text-lg">{t('account.avatarTitle')}</CardTitle>
            <CardDescription>{t('account.avatarDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6">
            <Avatar className="h-20 w-20 bg-[var(--color-accent-primary-soft)] border border-[var(--color-app-border-strong)]">
              {account.image && (
                <AvatarPrimitive.Image
                  src={account.image}
                  alt={account.name}
                  className="h-full w-full object-cover"
                />
              )}
              <AvatarFallback className="bg-transparent text-[var(--color-app-fg)] font-semibold text-2xl">
                {account.name
                  .split(/\s+/)
                  .map((p) => p[0])
                  .filter(Boolean)
                  .slice(0, 2)
                  .join('')
                  .toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <label className="inline-flex min-h-11 items-center gap-2 cursor-pointer rounded-lg focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--theme-focus)] border border-[var(--color-app-border-strong)] bg-[var(--color-app-surface)] hover:bg-[var(--color-app-surface-hover)] px-3.5 py-2 text-sm font-medium transition-colors">
                {uploadingAvatar ? <Spinner /> : <Upload className="h-3.5 w-3.5" />}
                {t('account.changeImage')}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  disabled={uploadingAvatar}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadAvatar(f);
                  }}
                />
              </label>
            </div>
          </CardContent>
        </Card>

        {/* Senha */}
        <Card elevated>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display text-lg">
              <KeyRound className="h-4 w-4 text-[var(--color-accent-primary)]" />
              {t('account.changePasswordTitle')}
            </CardTitle>
            <CardDescription>{t('account.passwordDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={changePassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="cur">{t('account.currentPassword')}</Label>
                <div className="relative">
                  <Input
                    id="cur"
                    autoComplete="current-password"
                    type={showPwd ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                    className="pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd((v) => !v)}
                    className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-[var(--color-app-muted)] hover:text-[var(--color-app-fg)]"
                    aria-label={
                      showPwd ? t('admin.integrations.hide') : t('admin.integrations.show')
                    }
                  >
                    {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new">{t('account.newPassword')}</Label>
                <Input
                  id="new"
                  autoComplete="new-password"
                  type={showPwd ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={12}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">{t('account.confirmNewPassword')}</Label>
                <Input
                  id="confirm"
                  autoComplete="new-password"
                  type={showPwd ? 'text' : 'password'}
                  value={confirmNew}
                  onChange={(e) => setConfirmNew(e.target.value)}
                  minLength={12}
                  required
                />
              </div>
              <div className="flex justify-end">
                <Button
                  type="submit"
                  variant="primary"
                  size="default"
                  disabled={
                    changingPwd ||
                    !currentPassword ||
                    newPassword.length < 12 ||
                    newPassword !== confirmNew
                  }
                >
                  {changingPwd && <Spinner />} {t('account.changePassword')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <QrLoginCard />
      </div>

      <p className="text-xs text-[var(--color-app-muted)] text-center pt-2">
        {t('account.createdAt', { date: formatDateTime(new Date(account.createdAt), locale) })}
      </p>
    </PageShell>
  );
}
