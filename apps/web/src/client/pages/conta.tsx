import { useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, Upload, User as UserIcon } from 'lucide-react';
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
    apiGet<{ user: AccountData }>('/api/account')
      .then((d) => {
        setAccount(d.user);
        setName(d.user.name);
      })
      .catch(() => undefined);
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
      toast.success('Nome atualizado.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Falha ao salvar.');
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
        throw new Error(body.error ?? 'Erro ao enviar imagem.');
      }
      const data = (await res.json()) as { image: string };
      setAccount((a) => (a ? { ...a, image: data.image } : a));
      await refresh();
      toast.success('Foto atualizada.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha no upload.');
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function changePassword(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (newPassword.length < 12) {
      toast.error('Nova senha precisa ter ao menos 12 caracteres.');
      return;
    }
    if (newPassword !== confirmNew) {
      toast.error('As senhas novas não conferem.');
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
      toast.success('Senha trocada.', {
        description: 'Outras sessões foram desconectadas.',
      });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Senha atual incorreta.');
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
      <div className="px-8 py-12 mx-auto max-w-2xl space-y-8">
        <header className="space-y-3">
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--color-app-muted)] font-medium">
            <UserIcon className="h-3.5 w-3.5 text-violet-400" />
            Conta
          </div>
          <h1 className="font-display text-4xl font-semibold tracking-[-0.03em]">Seu perfil</h1>
          <p className="text-[15px] text-[var(--color-app-muted)] leading-relaxed">
            Atualize seus dados e gerencie sua senha.
          </p>
        </header>

        {/* Avatar */}
        <Card elevated>
          <CardHeader>
            <CardTitle className="font-display text-lg">Foto de perfil</CardTitle>
            <CardDescription>PNG, JPG ou WebP até 5 MB.</CardDescription>
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
              <AvatarFallback className="bg-transparent text-zinc-100 font-semibold text-2xl">
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
                Trocar imagem
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
            <CardTitle className="font-display text-lg">Identidade</CardTitle>
            <CardDescription>E-mail não pode ser alterado por aqui (ainda).</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={saveName} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input id="email" value={account.email} disabled className="font-mono" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">Nome</Label>
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
                  {savingName ? <Spinner /> : 'Salvar'}
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
              Trocar senha
            </CardTitle>
            <CardDescription>Ao trocar, suas outras sessões serão desconectadas.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={changePassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="cur">Senha atual</Label>
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
                    className="absolute inset-y-0 right-3 flex items-center text-[var(--color-app-muted)] hover:text-zinc-100"
                    aria-label={showPwd ? 'Ocultar' : 'Ver'}
                  >
                    {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new">Nova senha</Label>
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
                <Label htmlFor="confirm">Confirmar nova senha</Label>
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
                  {changingPwd ? <Spinner /> : 'Trocar senha'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="text-xs text-[var(--color-app-muted)] text-center pt-2"
        >
          Conta criada em {formatDateTime(new Date(account.createdAt))}
        </motion.p>
      </div>
    </AnimatedPage>
  );
}
