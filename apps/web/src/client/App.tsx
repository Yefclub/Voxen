import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { Toaster } from './components/ui/sonner';
import { AppLayout } from './components/layout/app-layout';
import { AuthLayout } from './components/layout/auth-layout';
import { LoginPage } from './pages/login';
import { CadastroPage } from './pages/cadastro';
import { PendentePage } from './pages/pendente';
import { QrLoginPage } from './pages/qr-login';
import { OnboardingPage } from './pages/onboarding';
import { SetupPage } from './pages/setup';
import { HomePage } from './pages/home';
import { AdminUsuariosPage } from './pages/admin-usuarios';
import { AdminCustosPage } from './pages/admin-custos';
import { AdminIntegracoesPage } from './pages/admin-integracoes';
import { ContaPage } from './pages/conta';
import { JobDetalhePage } from './pages/jobs-detalhe';
import { TranscricoesPage } from './pages/transcricoes';
import { TranscricaoDetalhePage } from './pages/transcricoes-detalhe';
import { NotasPage } from './pages/notas';
import { AutomacoesPage } from './pages/automacoes';
import { GrafoPage } from './pages/grafo';
import { NovidadesPage } from './pages/novidades';
import { I18nProvider, useI18n } from './lib/i18n';
import { useMe } from './lib/hooks';

export function App(): React.ReactElement {
  return (
    <I18nProvider>
      <I18nRuntimeSync />
      <BrowserRouter>
        <Toaster />
        <AppRoutes />
      </BrowserRouter>
    </I18nProvider>
  );
}

type ViewTransitionHandle = {
  finished: Promise<void>;
  ready: Promise<void>;
  skipTransition: () => void;
};

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => ViewTransitionHandle;
};

/** Redirect que preserva search/hash (PWA share target em /jobs?shared=1&…). */
function RedirectPreserveSearch({ to }: { to: string }): React.ReactElement {
  const location = useLocation();
  return <Navigate to={`${to}${location.search}${location.hash}`} replace />;
}

function AppRoutes(): React.ReactElement {
  const location = useLocation();
  const [displayLocation, setDisplayLocation] = useState(location);

  useEffect(() => {
    if (location.key === displayLocation.key) return;
    const doc = document as ViewTransitionDocument;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!doc.startViewTransition || reduceMotion) {
      setDisplayLocation(location);
      return;
    }
    const transition = doc.startViewTransition(() => {
      flushSync(() => setDisplayLocation(location));
    });
    transition.finished.catch(() => undefined);
  }, [displayLocation.key, location]);

  return (
    <Routes location={displayLocation}>
      {/* Auth (sem login) */}
      <Route element={<AuthLayout />}>
        <Route path="/entrar" element={<LoginPage />} />
        <Route path="/cadastro" element={<CadastroPage />} />
      </Route>

      {/* Wizard de onboarding do admin (sem sidebar) */}
      <Route path="/onboarding" element={<OnboardingPage />} />

      {/* Estado de espera (sem layout) */}
      <Route path="/pendente" element={<PendentePage />} />

      {/* Consumo do QR de login (sem layout; device chega sem sessão) */}
      <Route path="/qr-login" element={<QrLoginPage />} />

      {/* App autenticado */}
      <Route element={<AppLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/dashboard" element={<RedirectPreserveSearch to="/" />} />
        <Route path="/chat" element={<RedirectPreserveSearch to="/" />} />
        <Route path="/chat/:id" element={<RedirectPreserveSearch to="/" />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/admin/usuarios" element={<AdminUsuariosPage />} />
        <Route path="/admin/custos" element={<AdminCustosPage />} />
        <Route path="/admin/integracoes" element={<AdminIntegracoesPage />} />
        <Route path="/conta" element={<ContaPage />} />
        <Route path="/jobs" element={<RedirectPreserveSearch to="/" />} />
        <Route path="/jobs/:id" element={<JobDetalhePage />} />
        <Route path="/transcricoes" element={<TranscricoesPage />} />
        <Route path="/transcricoes/:id" element={<TranscricaoDetalhePage />} />
        <Route path="/notas" element={<NotasPage />} />
        <Route path="/notas/:id" element={<NotasPage />} />
        <Route path="/automacoes" element={<AutomacoesPage />} />
        <Route path="/grafo" element={<GrafoPage />} />
        <Route path="/novidades" element={<NovidadesPage />} />
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
