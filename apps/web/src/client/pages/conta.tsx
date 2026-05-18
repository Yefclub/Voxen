import { useEffect, useState } from 'react';
import {
  Check,
  Copy as CopyIcon,
  Eye,
  EyeOff,
  KeyRound,
  Send,
  Unlink,
  Upload,
  User as UserIcon,
} from 'lucide-react';
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

        <TelegramLinkCard />

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

interface TelegramStatus {
  linked: boolean;
  username?: string | null;
  chatId?: string;
  linkedAt?: string;
}

function TelegramLinkCard(): React.ReactElement {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [codeExpiresAt, setCodeExpiresAt] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh(): Promise<void> {
    try {
      const s = await apiGet<TelegramStatus>('/api/account/telegram');
      setStatus(s);
    } catch {
      setStatus({ linked: false });
    }
  }

  async function genCode(): Promise<void> {
    setGenerating(true);
    try {
      const r = await apiPost<{ code: string; expiresInSec: number }>(
        '/api/account/telegram/code',
        {},
      );
      setCode(r.code);
      setCodeExpiresAt(Date.now() + r.expiresInSec * 1000);
      toast.success('Código gerado. Mande no bot dentro de 10 minutos.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao gerar código.');
    } finally {
      setGenerating(false);
    }
  }

  async function copyCode(): Promise<void> {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(`/start ${code}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignora
    }
  }

  async function unlink(): Promise<void> {
    setUnlinking(true);
    try {
      const res = await fetch('/api/account/telegram', {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Falha ao desvincular.');
      toast.success('Telegram desvinculado.');
      setStatus({ linked: false });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro.');
    } finally {
      setUnlinking(false);
    }
  }

  // Poll status quando código está ativo — detecta vínculo automaticamente
  useEffect(() => {
    if (!code) return;
    const timer = setInterval(() => {
      void apiGet<TelegramStatus>('/api/account/telegram')
        .then((s) => {
          if (s.linked) {
            setStatus(s);
            setCode(null);
            setCodeExpiresAt(null);
            toast.success('Telegram vinculado!');
          } else if (codeExpiresAt && Date.now() > codeExpiresAt) {
            setCode(null);
            setCodeExpiresAt(null);
            toast.warning('Código expirou.');
          }
        })
        .catch(() => undefined);
    }, 3000);
    return () => clearInterval(timer);
  }, [code, codeExpiresAt]);

  if (!status) {
    return (
      <Card>
        <CardContent className="pt-6">
          <Spinner />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-display">
          <Send className="h-4 w-4 text-violet-400" />
          Telegram
        </CardTitle>
        <CardDescription>
          Vincule sua conta pra falar com a Vox e buscar na biblioteca pelo bot do Telegram.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {status.linked ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 flex items-center gap-3">
              <Check className="h-4 w-4 text-emerald-400" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-zinc-100">
                  Vinculado {status.username ? `como @${status.username}` : ''}
                </p>
                <p className="text-[11px] text-[var(--color-app-muted)] tabular-nums">
                  chat_id <span className="font-mono">{status.chatId}</span>
                  {status.linkedAt && (
                    <>
                      {' · '}
                      desde {formatDateTime(new Date(status.linkedAt))}
                    </>
                  )}
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => void unlink()} disabled={unlinking}>
              {unlinking ? <Spinner /> : <Unlink className="h-3.5 w-3.5" />}
              Desvincular
            </Button>
          </div>
        ) : code ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 px-4 py-4">
              <p className="text-[11px] uppercase tracking-wider text-violet-300 font-medium mb-2">
                No bot do Voxen no Telegram, envie:
              </p>
              <code className="block font-mono text-2xl font-bold tracking-wider text-zinc-100 tabular-nums">
                /start {code}
              </code>
              <p className="text-[11px] text-[var(--color-app-muted)] mt-2">
                Expira em 10 minutos. Detecto o vínculo automaticamente.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void copyCode()}>
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Copiado
                </>
              ) : (
                <>
                  <CopyIcon className="h-3.5 w-3.5" />
                  Copiar comando
                </>
              )}
            </Button>
          </div>
        ) : (
          <Button
            variant="primary"
            size="default"
            onClick={() => void genCode()}
            disabled={generating}
          >
            {generating ? <Spinner /> : <Send className="h-3.5 w-3.5" />}
            Gerar código de vínculo
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
