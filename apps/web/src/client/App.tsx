import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from './components/ui/sonner';
import { AppLayout } from './components/layout/app-layout';
import { AuthLayout } from './components/layout/auth-layout';
import { LoginPage } from './pages/login';
import { CadastroPage } from './pages/cadastro';
import { PendentePage } from './pages/pendente';
import { OnboardingPage } from './pages/onboarding';
import { SetupPage } from './pages/setup';
import { DashboardPage } from './pages/dashboard';
import { AdminUsuariosPage } from './pages/admin-usuarios';
import { AdminCustosPage } from './pages/admin-custos';
import { ContaPage } from './pages/conta';
import { ChatPage } from './pages/chat';
import { JobsPage } from './pages/jobs';
import { JobDetalhePage } from './pages/jobs-detalhe';
import { TranscricoesPage } from './pages/transcricoes';
import { TranscricaoDetalhePage } from './pages/transcricoes-detalhe';
import { NotasPage } from './pages/notas';

export function App(): React.ReactElement {
  return (
    <BrowserRouter>
      <Toaster />
      <Routes>
        {/* Auth (sem login) */}
        <Route element={<AuthLayout />}>
          <Route path="/entrar" element={<LoginPage />} />
          <Route path="/cadastro" element={<CadastroPage />} />
        </Route>

        {/* Wizard de onboarding do admin (sem sidebar) */}
        <Route path="/onboarding" element={<OnboardingPage />} />

        {/* Estado de espera (sem layout) */}
        <Route path="/pendente" element={<PendentePage />} />

        {/* App autenticado */}
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/chat/:id" element={<ChatPage />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/admin/usuarios" element={<AdminUsuariosPage />} />
          <Route path="/admin/custos" element={<AdminCustosPage />} />
          <Route path="/conta" element={<ContaPage />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/jobs/:id" element={<JobDetalhePage />} />
          <Route path="/transcricoes" element={<TranscricoesPage />} />
          <Route path="/transcricoes/:id" element={<TranscricaoDetalhePage />} />
          <Route path="/notas" element={<NotasPage />} />
          <Route path="/notas/:id" element={<NotasPage />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
