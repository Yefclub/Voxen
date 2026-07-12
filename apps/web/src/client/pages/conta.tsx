import { useEffect, useState } from 'react';
import {
  Eye,
  EyeOff,
  KeyRound,
  QrCode,
  RefreshCw,
  ShieldAlert,
  Smartphone,
  Upload,
  User as UserIcon,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Avatar, AvatarFallback } from '../components/ui/avatar';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Spinner } from '../components/ui/spinner';
import { ApiError, api, apiGet, apiPost } from '../lib/api';
import { useMe } from '../lib/hooks';
import { AnimatedPage } from '../components/motion/animated-page';
import { formatDateTime } from '../lib/format';
import { useI18n } from '../lib/i18n';

interface AccountData {
  id: string;
  email: string;
  name: string;
  image: string | null;
  role: 'ADMIN' | 'USER';
  status: string;
  monthlyBudgetUsd: string | null;
  createdAt: string;
}

export function ContaPage(): React.ReactElement {
  const { refresh } = useMe();
  const { locale, t } = useI18n();
  const [account, setAccount] = useState<AccountData | null>(null);
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
    apiGet<{ user: AccountData }>('/api/account')
      .then((d) => {
        if (cancelled) return;
        setAccount(d.user);
        setName(d.user.name);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

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
      <div className="px-8 py-24 flex justify-center">
        <Spinner size={20} className="text-[var(--color-app-muted)]" />
      </div>
    );
  }

  return (
    <AnimatedPage>
      <div className="px-4 sm:px-8 py-8 sm:py-12 mx-auto max-w-2xl space-y-8">
        <header className="space-y-3">
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--color-app-muted)] font-medium">
            <UserIcon className="h-3.5 w-3.5 text-violet-400" />
            {t('account.eyebrow')}
          </div>
          <h1 className="font-display text-4xl font-semibold tracking-[-0.03em]">
            {t('account.title')}
          </h1>
          <p className="text-[15px] text-[var(--color-app-muted)] leading-relaxed">
            {t('account.description')}
          </p>
        </header>

        {/* Avatar */}
        <Card elevated>
          <CardHeader>
            <CardTitle className="font-display text-lg">{t('account.avatarTitle')}</CardTitle>
            <CardDescription>{t('account.avatarDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-6">
            <Avatar className="h-20 w-20 bg-gradient-to-br from-emerald-500/30 to-violet-500/30 border border-[var(--color-app-border-strong)]">
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
              <label className="inline-flex items-center gap-2 cursor-pointer rounded-lg border border-[var(--color-app-border-strong)] bg-[var(--color-app-surface)] hover:bg-[var(--color-app-surface-hover)] px-3.5 py-2 text-sm font-medium transition-colors">
                {uploadingAvatar ? <Spinner /> : <Upload className="h-3.5 w-3.5" />}
                {t('account.changeImage')}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadAvatar(f);
                  }}
                />
              </label>
            </div>
          </CardContent>
        </Card>

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
                <Input id="email" value={account.email} disabled className="font-mono" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">{t('auth.name')}</Label>
                <Input
                  id="name"
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
                  {savingName ? <Spinner /> : t('common.save')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Senha */}
        <Card elevated>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display text-lg">
              <KeyRound className="h-4 w-4 text-emerald-400" />
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
                    type={showPwd ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                    className="font-mono pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd((v) => !v)}
                    className="absolute inset-y-0 right-3 flex items-center text-[var(--color-app-muted)] hover:text-[var(--color-app-fg)]"
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
                  type={showPwd ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={12}
                  required
                  className="font-mono"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">{t('account.confirmNewPassword')}</Label>
                <Input
                  id="confirm"
                  type={showPwd ? 'text' : 'password'}
                  value={confirmNew}
                  onChange={(e) => setConfirmNew(e.target.value)}
                  minLength={12}
                  required
                  className="font-mono"
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
                  {changingPwd ? <Spinner /> : t('account.changePassword')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <QrLoginCard />

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="text-xs text-[var(--color-app-muted)] text-center pt-2"
        >
          {t('account.createdAt', { date: formatDateTime(new Date(account.createdAt), locale) })}
        </motion.p>
      </div>
    </AnimatedPage>
  );
}

function QrLoginCard(): React.ReactElement {
  const { t } = useI18n();
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [generating, setGenerating] = useState(false);

  async function generate(): Promise<void> {
    setGenerating(true);
    try {
      const r = await apiPost<{ loginUrl: string; expiresInSec: number }>(
        '/api/account/qr-login',
        {},
      );
      setLoginUrl(r.loginUrl);
      setExpiresAt(Date.now() + r.expiresInSec * 1000);
      setRemaining(r.expiresInSec);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('account.qrLogin.error'));
    } finally {
      setGenerating(false);
    }
  }

  // Countdown: zera o QR quando expira (o token já não vale mais no servidor).
  useEffect(() => {
    if (!expiresAt) return;
    const tick = (): void => {
      const secs = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setRemaining(secs);
      if (secs <= 0) {
        setLoginUrl(null);
        setExpiresAt(null);
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-display">
          <QrCode className="h-4 w-4 text-emerald-400" />
          {t('account.qrLogin.title')}
        </CardTitle>
        <CardDescription>{t('account.qrLogin.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {loginUrl ? (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-3">
              <div className="rounded-xl bg-white p-3">
                <QRCodeSVG value={loginUrl} size={200} level="M" marginSize={0} />
              </div>
              <p className="text-[13px] text-[var(--color-app-muted)] flex items-center gap-1.5">
                <Smartphone className="h-3.5 w-3.5" />
                {t('account.qrLogin.scanHint')}
              </p>
              <p className="text-xs text-[var(--color-app-muted)] tabular-nums">
                {t('account.qrLogin.expiresIn', { seconds: remaining })}
              </p>
            </div>

            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 flex items-start gap-2.5">
              <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[13px] text-amber-200/90 leading-relaxed">
                {t('account.qrLogin.warning')}
              </p>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => void generate()}
              disabled={generating}
            >
              {generating ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" />}
              {t('account.qrLogin.regenerate')}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 flex items-start gap-2.5">
              <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[13px] text-amber-200/90 leading-relaxed">
                {t('account.qrLogin.warning')}
              </p>
            </div>
            <Button
              variant="primary"
              size="default"
              onClick={() => void generate()}
              disabled={generating}
            >
              {generating ? <Spinner /> : <QrCode className="h-3.5 w-3.5" />}
              {t('account.qrLogin.generate')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
