import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Link2, Plus, RefreshCw } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { Spinner } from '../components/ui/spinner';
import { ApiError, apiPost } from '../lib/api';
import { useFetch } from '../lib/hooks';
import { formatRelative } from '../lib/format';
import { jobStatusBadge } from '../lib/job-display';
import type { JobSummary } from '../lib/types';

export function JobsPage(): React.ReactElement {
  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data, loading, refresh } = useFetch<{ jobs: JobSummary[] }>('/api/jobs');

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiPost('/api/jobs', { url });
      setUrl('');
      refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Erro inesperado.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  const jobs = data?.jobs ?? [];

  return (
    <div className="px-8 py-10 mx-auto max-w-6xl space-y-8">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wider text-zinc-500 font-medium">Transcrever</p>
        <h1 className="text-3xl font-semibold tracking-tight">Novo vídeo</h1>
        <p className="text-sm text-zinc-400 mt-2">
          Cole um link do YouTube. O Voxen baixa, transcreve e indexa para busca.
        </p>
      </header>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={onSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="url">URL do vídeo</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                  <Input
                    id="url"
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://youtu.be/..."
                    autoComplete="off"
                    required
                    className="pl-9 font-mono"
                  />
                </div>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={submitting || url.trim().length === 0}
                >
                  {submitting ? <Spinner /> : <Plus className="h-4 w-4" />}
                  Adicionar
                </Button>
              </div>
              <p className="text-xs text-zinc-500">
                Aceita youtu.be, youtube.com/watch e shorts. Outros sites virão depois.
              </p>
            </div>
          </form>
        </CardContent>
      </Card>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">Sua fila</h2>
          <Button variant="ghost" size="sm" onClick={() => refresh()}>
            <RefreshCw className="h-3.5 w-3.5" />
            Atualizar
          </Button>
        </div>

        {loading && (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        )}

        {!loading && jobs.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-sm text-zinc-500">
              Você ainda não enviou nenhum vídeo. Cole um link acima para começar.
            </CardContent>
          </Card>
        )}

        {!loading && jobs.length > 0 && (
          <Card>
            <ul className="divide-y divide-zinc-800/80">
              {jobs.map((j) => {
                const { variant, label } = jobStatusBadge(j.status);
                return (
                  <li
                    key={j.id}
                    className="flex items-center gap-4 px-5 py-4 hover:bg-zinc-900/40 transition-colors"
                  >
                    <Badge variant={variant} className="shrink-0 w-28 justify-center">
                      {label}
                    </Badge>
                    <div className="flex-1 min-w-0 space-y-1">
                      <p className="text-sm text-zinc-200 truncate font-mono">{j.sourceUrl}</p>
                      <p className="text-xs text-zinc-500">
                        {j.finishedAt
                          ? `Finalizado ${formatRelative(new Date(j.finishedAt))}`
                          : `Enfileirado ${formatRelative(new Date(j.queuedAt))}`}
                      </p>
                      {j.errorMsg && <p className="text-xs text-red-300 mt-1">{j.errorMsg}</p>}
                    </div>
                    <Button variant="ghost" size="sm" asChild>
                      <Link to={`/jobs/${j.id}`}>
                        Detalhes <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}
