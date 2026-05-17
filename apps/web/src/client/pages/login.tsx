import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Spinner } from '../components/ui/spinner';
import { ApiError, apiPost } from '../lib/api';
import { useMe } from '../lib/hooks';

export function LoginPage(): React.ReactElement {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { refresh } = useMe();

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiPost('/api/auth/sign-in/email', { email, password });
      await refresh();
      navigate('/dashboard');
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError(err.message);
      } else if (err instanceof ApiError) {
        setError('E-mail ou senha incorretos.');
      } else {
        setError('Erro inesperado. Tente novamente.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm space-y-8">
      <div className="space-y-3">
        <h1 className="font-display text-3xl font-semibold tracking-[-0.03em]">Entrar no Voxen</h1>
        <p className="text-sm text-[var(--color-app-muted)] leading-relaxed">
          Acesse sua knowledge base de vídeos transcritos.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@exemplo.com"
            autoComplete="email"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Senha</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••••••"
            autoComplete="current-password"
            minLength={12}
            required
          />
        </div>

        <Button type="submit" variant="primary" size="xl" className="w-full" disabled={loading}>
          {loading ? <Spinner /> : 'Entrar'}
          {!loading && <ArrowRight className="h-4 w-4" />}
        </Button>
      </form>

      <div className="pt-6 border-t border-[var(--color-app-border)] text-center text-sm text-[var(--color-app-muted)]">
        Ainda não tem conta?{' '}
        <Link
          to="/cadastro"
          className="text-zinc-100 font-medium hover:text-emerald-400 transition-colors"
        >
          Criar conta
        </Link>
      </div>
    </div>
  );
}
