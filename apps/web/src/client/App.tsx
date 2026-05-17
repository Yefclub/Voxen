import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from './components/layout/app-layout';
import { AuthLayout } from './components/layout/auth-layout';
import { LoginPage } from './pages/login';
import { CadastroPage } from './pages/cadastro';
import { PendentePage } from './pages/pendente';
import { SetupPage } from './pages/setup';
import { DashboardPage } from './pages/dashboard';
import { AdminUsuariosPage } from './pages/admin-usuarios';
import { JobsPage } from './pages/jobs';
import { JobDetalhePage } from './pages/jobs-detalhe';
import { TranscricoesPage } from './pages/transcricoes';
import { TranscricaoDetalhePage } from './pages/transcricoes-detalhe';

export function App(): React.ReactElement {
  return (
    <BrowserRouter>
      <Routes>
        {/* Auth (sem login) */}
        <Route element={<AuthLayout />}>
          <Route path="/entrar" element={<LoginPage />} />
          <Route path="/cadastro" element={<CadastroPage />} />
        </Route>

        {/* Estado de espera (sem layout) */}
        <Route path="/pendente" element={<PendentePage />} />

        {/* App autenticado */}
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/admin/usuarios" element={<AdminUsuariosPage />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/jobs/:id" element={<JobDetalhePage />} />
          <Route path="/transcricoes" element={<TranscricoesPage />} />
          <Route path="/transcricoes/:id" element={<TranscricaoDetalhePage />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
