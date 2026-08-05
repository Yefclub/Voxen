import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Toaster } from './components/ui/sonner';
import { Spinner } from './components/ui/spinner';
import { AppLayout } from './components/layout/app-layout';
import { AdminLayout } from './components/layout/admin-layout';
import { AuthLayout } from './components/layout/auth-layout';
import { RootEntry } from './pages/root-entry';
import { I18nProvider, useI18n } from './lib/i18n';
import { ThemeProvider } from './lib/theme-provider';
import { InterfaceModeProvider } from './lib/interface-mode-provider';
import { useMe } from './lib/hooks';
import { PwaInstallPrompt } from './components/pwa-install-prompt';

// Telas carregadas somente quando a rota precisa delas. O shell, a sessao e a
// navegacao continuam no bundle inicial; areas com editor, grafo e Markdown
// deixam de atrasar a primeira abertura do chat no web e no PWA instalado.
const LoginPage = lazy(() =>
  import('./pages/login').then(({ LoginPage }) => ({ default: LoginPage })),
);
const CadastroPage = lazy(() =>
  import('./pages/cadastro').then(({ CadastroPage }) => ({ default: CadastroPage })),
);
const PendentePage = lazy(() =>
  import('./pages/pendente').then(({ PendentePage }) => ({ default: PendentePage })),
);
const QrLoginPage = lazy(() =>
  import('./pages/qr-login').then(({ QrLoginPage }) => ({ default: QrLoginPage })),
);
const OnboardingPage = lazy(() =>
  import('./pages/onboarding').then(({ OnboardingPage }) => ({ default: OnboardingPage })),
);
const SetupPage = lazy(() =>
  import('./pages/setup').then(({ SetupPage }) => ({ default: SetupPage })),
);
const AdminUsuariosPage = lazy(() =>
  import('./pages/admin-usuarios').then(({ AdminUsuariosPage }) => ({
    default: AdminUsuariosPage,
  })),
);
const AdminCustosPage = lazy(() =>
  import('./pages/admin-custos').then(({ AdminCustosPage }) => ({ default: AdminCustosPage })),
);
const AdminIntegracoesPage = lazy(() =>
  import('./pages/admin-integracoes').then(({ AdminIntegracoesPage }) => ({
    default: AdminIntegracoesPage,
  })),
);
const AdminAutenticacaoPage = lazy(() =>
  import('./pages/admin-autenticacao').then(({ AdminAutenticacaoPage }) => ({
    default: AdminAutenticacaoPage,
  })),
);
const ContaPage = lazy(() =>
  import('./pages/conta').then(({ ContaPage }) => ({ default: ContaPage })),
);
const ContaPlataformasPage = lazy(() =>
  import('./pages/conta-plataformas').then(({ ContaPlataformasPage }) => ({
    default: ContaPlataformasPage,
  })),
);
const ContaMcpPage = lazy(() =>
  import('./pages/conta-mcp').then(({ ContaMcpPage }) => ({ default: ContaMcpPage })),
);
const FilaPage = lazy(() => import('./pages/fila').then(({ FilaPage }) => ({ default: FilaPage })));
const JobDetalhePage = lazy(() =>
  import('./pages/jobs-detalhe').then(({ JobDetalhePage }) => ({ default: JobDetalhePage })),
);
const TranscricoesPage = lazy(() =>
  import('./pages/transcricoes').then(({ TranscricoesPage }) => ({ default: TranscricoesPage })),
);
const TranscricaoDetalhePage = lazy(() =>
  import('./pages/transcricoes-detalhe').then(({ TranscricaoDetalhePage }) => ({
    default: TranscricaoDetalhePage,
  })),
);
const NotasPage = lazy(() =>
  import('./pages/notas').then(({ NotasPage }) => ({ default: NotasPage })),
);
const AutomacoesPage = lazy(() =>
  import('./pages/automacoes').then(({ AutomacoesPage }) => ({ default: AutomacoesPage })),
);
const GrafoPage = lazy(() =>
  import('./pages/grafo').then(({ GrafoPage }) => ({ default: GrafoPage })),
);
const NovidadesPage = lazy(() =>
  import('./pages/novidades').then(({ NovidadesPage }) => ({ default: NovidadesPage })),
);
const ExtensaoPage = lazy(() =>
  import('./pages/extensao').then(({ ExtensaoPage }) => ({ default: ExtensaoPage })),
);
const ChatPage = lazy(() => import('./pages/chat').then(({ ChatPage }) => ({ default: ChatPage })));

export function App(): React.ReactElement {
  return (
    <I18nProvider>
      <ThemeProvider>
        <InterfaceModeProvider>
          <I18nRuntimeSync />
          <BrowserRouter>
            <Toaster />
            <PwaInstallGate />
            <AppRoutes />
          </BrowserRouter>
        </InterfaceModeProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}

function PwaInstallGate(): React.ReactElement {
  const { data } = useMe();
  return <PwaInstallPrompt enabled={Boolean(data?.user)} />;
}

function PublicRouteBoundary({ children }: { children: ReactNode }): React.ReactElement {
  return <Suspense fallback={<FullscreenRouteLoading />}>{children}</Suspense>;
}

function FullscreenRouteLoading(): React.ReactElement {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <Spinner size={20} className="text-[var(--color-app-muted)]" />
      <span className="sr-only">Carregando tela</span>
    </div>
  );
}

/** Redirect that preserves search/hash (legacy `/dashboard`, share-target query params). */
function RedirectPreserveSearch({ to }: { to: string }): React.ReactElement {
  const location = useLocation();
  return <Navigate to={`${to}${location.search}${location.hash}`} replace />;
}

/** `/jobs` list → queue; share-target query → library ingest. */
function JobsIndexRedirect(): React.ReactElement {
  const location = useLocation();
  const shared = new URLSearchParams(location.search).get('shared') === '1';
  const to = shared ? '/transcricoes' : '/fila';
  return <Navigate to={`${to}${location.search}${location.hash}`} replace />;
}

function AppRoutes(): React.ReactElement {
  return (
    <Routes>
      {/* Auth (sem login) */}
      <Route
        element={
          <PublicRouteBoundary>
            <AuthLayout />
          </PublicRouteBoundary>
        }
      >
        <Route path="/entrar" element={<LoginPage />} />
        <Route path="/cadastro" element={<CadastroPage />} />
      </Route>

      {/* Wizard de onboarding do admin (sem sidebar) */}
      <Route
        path="/onboarding"
        element={
          <PublicRouteBoundary>
            <OnboardingPage />
          </PublicRouteBoundary>
        }
      />

      {/* Estado de espera (sem layout) */}
      <Route
        path="/pendente"
        element={
          <PublicRouteBoundary>
            <PendentePage />
          </PublicRouteBoundary>
        }
      />

      {/* Consumo do QR de login (sem layout; device chega sem sessão) */}
      <Route
        path="/qr-login"
        element={
          <PublicRouteBoundary>
            <QrLoginPage />
          </PublicRouteBoundary>
        }
      />

      {/* App autenticado */}
      <Route element={<AppLayout />}>
        <Route path="/" element={<RootEntry ChatPage={ChatPage} />} />
        <Route path="/dashboard" element={<RedirectPreserveSearch to="/" />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/chat/:id" element={<RedirectPreserveSearch to="/chat" />} />
        <Route path="/setup" element={<RedirectPreserveSearch to="/admin/configuracao" />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Navigate to="configuracao" replace />} />
          <Route path="configuracao" element={<SetupPage />} />
          <Route path="usuarios" element={<AdminUsuariosPage />} />
          <Route path="custos" element={<AdminCustosPage />} />
          <Route path="integracoes" element={<AdminIntegracoesPage />} />
          <Route path="autenticacao" element={<AdminAutenticacaoPage />} />
        </Route>
        <Route path="/conta" element={<ContaPage />} />
        <Route path="/conta/plataformas" element={<ContaPlataformasPage />} />
        <Route path="/conta/mcp" element={<ContaMcpPage />} />
        <Route path="/fila" element={<FilaPage />} />
        <Route path="/jobs" element={<JobsIndexRedirect />} />
        <Route path="/jobs/:id" element={<JobDetalhePage />} />
        <Route path="/transcricoes" element={<TranscricoesPage />} />
        <Route path="/transcricoes/:id" element={<TranscricaoDetalhePage />} />
        <Route path="/notas" element={<NotasPage />} />
        <Route path="/notas/:id" element={<NotasPage />} />
        <Route path="/automacoes" element={<AutomacoesPage />} />
        <Route path="/artefatos" element={<Navigate to="/" replace />} />
        <Route path="/grafo" element={<GrafoPage />} />
        <Route path="/novidades" element={<NovidadesPage />} />
        <Route path="/extensao" element={<ExtensaoPage />} />
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function I18nRuntimeSync(): null {
  const { data } = useMe();
  const { setLocale } = useI18n();

  useEffect(() => {
    if (data?.language) setLocale(data.language);
  }, [data?.language, setLocale]);

  return null;
}
