import { Outlet, Navigate } from 'react-router-dom';
import { useMe } from '../../lib/hooks';
import { Spinner } from '../ui/spinner';

export function AuthLayout(): React.ReactElement {
  const { data, loading } = useMe();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner className="h-6 w-6 text-zinc-400" />
      </div>
    );
  }

  // Já logado e aprovado: vai pro dashboard
  if (data?.user && data.user.status === 'APPROVED') {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex h-16 items-center px-8 border-b border-zinc-800/40">
        <div className="flex items-center gap-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500 text-emerald-950 font-bold text-xs">
            V
          </div>
          <span className="text-sm font-semibold tracking-tight">Voxen</span>
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <Outlet />
      </main>
      <footer className="px-8 py-5 text-[11px] text-zinc-600 border-t border-zinc-800/40 text-center">
        Knowledge base self-hosted · alimentada por transcrição.
      </footer>
    </div>
  );
}
