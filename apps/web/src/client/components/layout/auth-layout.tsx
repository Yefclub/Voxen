import { Outlet, Navigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { useMe } from '../../lib/hooks';
import { Spinner } from '../ui/spinner';

export function AuthLayout(): React.ReactElement {
  const { data, loading } = useMe();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner className="text-[var(--color-app-muted)]" size={20} />
      </div>
    );
  }

  if (data?.user && data.user.status === 'APPROVED') {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-[1fr_1.1fr]">
      {/* Lado esquerdo: form */}
      <div className="flex flex-col px-8 lg:px-16 py-10">
        <header className="flex items-center gap-3 mb-12">
          <div className="relative">
            <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-emerald-400 to-violet-500 blur-md opacity-50" />
            <div className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-violet-500 text-zinc-950 font-bold text-base font-display">
              V
            </div>
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-base font-semibold font-display tracking-tight">Voxen</span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-app-muted)] mt-1">
              knowledge base
            </span>
          </div>
        </header>

        <motion.main
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="flex-1 flex items-center justify-center"
        >
          <Outlet />
        </motion.main>

        <footer className="text-[11px] text-[var(--color-app-muted)] mt-10">
          Self-hosted · sem embeddings · sem hype.
        </footer>
      </div>

      {/* Lado direito: painel decorado (escondido em mobile) */}
      <div className="hidden lg:block relative overflow-hidden bg-[var(--color-app-bg-elevated)] border-l border-[var(--color-app-border)]">
        <DecorPanel />
      </div>
    </div>
  );
}

function DecorPanel(): React.ReactElement {
  return (
    <div className="relative h-full">
      {/* Gradiente forte de fundo */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 70% 50% at 30% 20%, oklch(72% 0.18 290 / 0.18), transparent 60%), radial-gradient(ellipse 70% 50% at 80% 80%, oklch(73% 0.16 159 / 0.15), transparent 60%)',
        }}
      />

      {/* Grid lines tipo blueprint */}
      <svg
        aria-hidden
        className="absolute inset-0 h-full w-full opacity-[0.08]"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id="g" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M 48 0 L 0 0 0 48" fill="none" stroke="currentColor" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#g)" />
      </svg>

      {/* Conteúdo */}
      <div className="relative h-full flex flex-col justify-center px-12 xl:px-20">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="max-w-md"
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-app-border-strong)] bg-[var(--color-app-surface)]/60 px-3 py-1 mb-6 backdrop-blur-sm">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-60" />
              <span className="relative rounded-full bg-emerald-400 h-full w-full" />
            </span>
            <span className="text-[11px] uppercase tracking-[0.15em] text-[var(--color-app-subtle)]">
              v0 · self-hosted
            </span>
          </div>

          <h2 className="font-display text-4xl xl:text-5xl font-semibold leading-[1.05] tracking-[-0.04em] text-balance">
            Sua biblioteca de vídeos, <span className="text-gradient">navegada por um agente.</span>
          </h2>

          <p className="mt-6 text-[15px] leading-relaxed text-[var(--color-app-subtle)] max-w-sm">
            Cole um link, o Voxen transcreve e indexa. Depois, converse com seu acervo como se fosse
            um colega que assistiu tudo.
          </p>

          {/* Pequenos features inline */}
          <ul className="mt-10 space-y-3 text-sm text-[var(--color-app-subtle)]">
            <li className="flex items-center gap-3">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              YouTube hoje · Instagram e TikTok em breve
            </li>
            <li className="flex items-center gap-3">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
              Sem embeddings — tools determinísticas (abordagem Karpathy)
            </li>
            <li className="flex items-center gap-3">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              100% local · OpenRouter como único upstream
            </li>
          </ul>
        </motion.div>
      </div>
    </div>
  );
}
