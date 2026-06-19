// ============================================================================
// ErrorBoundary — fallback global pra erros de render (spec 048)
// ============================================================================
// React não tem boundary declarativo built-in: a API oficial é um class
// component com getDerivedStateFromError + componentDidCatch. Este boundary
// fica ACIMA do I18nProvider (envolve <App/>), então não pode usar useI18n —
// lê o locale persistido direto do localStorage e escolhe o texto. Sem isso, um
// erro de render derruba o PWA pra tela branca sem ação de recuperação.
// ============================================================================

import { Component, type ErrorInfo, type ReactNode } from 'react';

const STORAGE_KEY = 'voxen:locale';

type Locale = 'pt-BR' | 'en';

const COPY: Record<Locale, { title: string; description: string; reload: string }> = {
  'pt-BR': {
    title: 'Algo deu errado',
    description:
      'A aplicação encontrou um erro inesperado. Recarregar a página costuma resolver. Se persistir, avise o administrador.',
    reload: 'Recarregar',
  },
  en: {
    title: 'Something went wrong',
    description:
      'The app hit an unexpected error. Reloading the page usually fixes it. If it persists, let the administrator know.',
    reload: 'Reload',
  },
};

function resolveLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'en') return 'en';
    if (stored && stored.toLowerCase().startsWith('pt')) return 'pt-BR';
  } catch {
    // localStorage indisponível (modo privado/restrito) — cai no default.
  }
  return 'pt-BR';
}

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Loga no console pro owner inspecionar (self-hosted, sem telemetria).
    console.error('[ErrorBoundary] erro de render capturado:', error, info.componentStack);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    const copy = COPY[resolveLocale()];
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 text-center">
        <div className="max-w-md space-y-5">
          <img
            src="/voxen-256.png"
            alt="Voxen"
            width={64}
            height={64}
            draggable={false}
            className="mx-auto h-16 w-16 select-none opacity-90"
          />
          <div className="space-y-2">
            <h1 className="text-xl font-semibold tracking-tight text-zinc-100">{copy.title}</h1>
            <p className="text-sm leading-relaxed text-zinc-400">{copy.description}</p>
          </div>
          <button
            type="button"
            onClick={this.handleReload}
            className="inline-flex items-center justify-center rounded-lg border border-zinc-700 bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-white active:scale-95"
          >
            {copy.reload}
          </button>
        </div>
      </div>
    );
  }
}
