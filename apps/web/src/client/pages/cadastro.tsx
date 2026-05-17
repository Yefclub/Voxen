import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Spinner } from '../components/ui/spinner';
import { apiPost, ApiError } from '../lib/api';
import { useMe } from '../lib/hooks';

export function CadastroPage(): React.ReactElement {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { refresh } = useMe();

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (password.length < 12) {
      setError('A senha precisa ter pelo menos 12 caracteres.');
      return;
    }
    setLoading(true);
    try {
      await apiPost('/api/auth/sign-up/email', { name, email, password });
      await refresh();
      // autoSignIn=false → user precisa logar manualmente. Mas se foi o
      // primeiro user (vira ADMIN), o login a seguir vai funcionar.
      navigate('/entrar', { state: { justSignedUp: true } });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Erro inesperado. Tente novamente.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Criar conta no Voxen</h1>
        <p className="text-sm text-zinc-400 leading-relaxed">
          O primeiro cadastro vira administrador automaticamente. Os próximos ficam pendentes até
          serem aprovados.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <Label htmlFor="name">Nome</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Como prefere ser chamado"
            autoComplete="name"
            required
            minLength={2}
          />
        </div>

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
            placeholder="Mínimo 12 caracteres"
            autoComplete="new-password"
            minLength={12}
            required
          />
          <p className="text-xs text-zinc-500 leading-relaxed">
            Use uma senha forte — esta é a única forma de acessar sua workspace.
          </p>
        </div>

        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={loading}>
          {loading ? <Spinner /> : 'Criar conta'}
          {!loading && <ArrowRight className="h-4 w-4" />}
        </Button>
      </form>

      <div className="mt-8 pt-6 border-t border-zinc-800/60 text-center text-sm text-zinc-400">
        Já tem conta?{' '}
        <Link
          to="/entrar"
          className="text-zinc-100 font-medium hover:text-emerald-400 transition-colors"
        >
          Entrar
        </Link>
      </div>
    </div>
  );
}
