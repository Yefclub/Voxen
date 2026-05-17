import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Link2, PlayCircle, Plus, RefreshCw } from 'lucide-react';
import { motion } from 'motion/react';
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
import { AnimatedPage, StaggerContainer, StaggerItem } from '../components/motion/animated-page';

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
      if (err instanceof ApiError) setError(err.message);
      else setError('Erro inesperado.');
    } finally {
      setSubmitting(false);
    }
  }

  const jobs = data?.jobs ?? [];

  return (
    <AnimatedPage>
      <div className="px-8 py-12 mx-auto max-w-6xl space-y-10">
        <header className="space-y-3">
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--color-app-muted)] font-medium">
            <PlayCircle className="h-3.5 w-3.5 text-rose-400" />
            Transcrever
          </div>
          <h1 className="font-display text-4xl font-semibold tracking-[-0.03em]">Novo vídeo</h1>
          <p className="text-[15px] text-[var(--color-app-muted)] leading-relaxed max-w-2xl">
            Cole um link do YouTube. O Voxen baixa, transcreve e indexa pra busca.
          </p>
        </header>

        {/* Form bonito com borda gradiente sutil */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        >
          <Card elevated className="overflow-hidden relative">
            <div
              aria-hidden
              className="absolute inset-0 opacity-40 pointer-events-none"
              style={{
                background:
                  'radial-gradient(ellipse 80% 50% at 0% 0%, oklch(73% 0.16 159 / 0.08), transparent 60%)',
              }}
            />
            <CardContent className="pt-6 relative">
              <form onSubmit={onSubmit} className="space-y-4">
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <div className="space-y-2">
                  <Label htmlFor="url">URL do vídeo</Label>
                  <div className="flex gap-2.5">
                    <div className="relative flex-1">
                      <Link2 className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-app-muted)] pointer-events-none" />
                      <Input
                        id="url"
                        type="url"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="https://youtu.be/..."
                        autoComplete="off"
                        required
                        className="pl-10 font-mono h-11 text-[15px]"
                      />
                    </div>
                    <Button
                      type="submit"
                      variant="primary"
                      size="lg"
                      disabled={submitting || url.trim().length === 0}
                      className="h-11 px-5"
                    >
                      {submitting ? <Spinner /> : <Plus className="h-4 w-4" />}
                      Adicionar
                    </Button>
                  </div>
                  <p className="text-xs text-[var(--color-app-muted)]">
                    Aceita youtu.be, youtube.com/watch e shorts.
                  </p>
                </div>
              </form>
            </CardContent>
          </Card>
        </motion.div>

        {/* Lista da fila */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="font-display text-xl font-semibold tracking-tight">Sua fila</h2>
              {jobs.length > 0 && (
                <span className="text-xs text-[var(--color-app-muted)] tabular-nums">
                  {jobs.length} {jobs.length === 1 ? 'item' : 'itens'}
                </span>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={refresh}>
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
              <CardContent className="py-12 text-center text-sm text-[var(--color-app-muted)]">
                Você ainda não enviou nenhum vídeo. Cole um link acima para começar.
              </CardContent>
            </Card>
          )}

          {!loading && jobs.length > 0 && (
            <Card>
              <StaggerContainer delay={0.05}>
                <ul className="divide-y divide-[var(--color-app-border)]">
                  {jobs.map((j) => {
                    const { variant, label } = jobStatusBadge(j.status);
                    return (
                      <StaggerItem key={j.id}>
                        <li className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-[var(--color-app-surface-hover)]/50">
                          <Badge variant={variant} className="shrink-0 w-28 justify-center">
                            {label}
                          </Badge>
                          <div className="flex-1 min-w-0 space-y-1">
                            <p className="text-sm text-zinc-200 truncate font-mono tracking-tight">
                              {j.sourceUrl}
                            </p>
                            <p className="text-xs text-[var(--color-app-muted)]">
                              {j.finishedAt
                                ? `Finalizado ${formatRelative(new Date(j.finishedAt))}`
                                : `Enfileirado ${formatRelative(new Date(j.queuedAt))}`}
                            </p>
                            {j.errorMsg && (
                              <p className="text-xs text-rose-300 mt-1">{j.errorMsg}</p>
                            )}
                          </div>
                          <Button variant="ghost" size="sm" asChild>
                            <Link to={`/jobs/${j.id}`}>
                              Detalhes
                              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                            </Link>
                          </Button>
                        </li>
                      </StaggerItem>
                    );
                  })}
                </ul>
              </StaggerContainer>
            </Card>
          )}
        </section>
      </div>
    </AnimatedPage>
  );
}
