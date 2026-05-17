import { useNavigate } from 'react-router-dom';
import { Clock, LogOut } from 'lucide-react';
import { Button } from '../components/ui/button';
import { useMe } from '../lib/hooks';
import { apiPost } from '../lib/api';

export function PendentePage(): React.ReactElement {
  const { data, refresh } = useMe();
  const navigate = useNavigate();

  const onSignOut = async (): Promise<void> => {
    await apiPost('/api/auth/sign-out').catch(() => undefined);
    await refresh();
    navigate('/entrar');
  };

  const status = data?.user?.status ?? 'PENDING';
  const isSetupIncomplete = !data?.setupComplete && data?.user?.role !== 'ADMIN';

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md text-center space-y-6">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 border border-amber-500/30">
            <Clock className="h-5 w-5 text-amber-400" />
          </div>

          {isSetupIncomplete ? (
            <>
              <h1 className="text-2xl font-semibold tracking-tight">Aguardando configuração</h1>
              <p className="text-sm text-zinc-400 leading-relaxed">
                O sistema ainda está sendo configurado pelo administrador. Volte em alguns
                instantes.
              </p>
            </>
          ) : status === 'PENDING' ? (
            <>
              <h1 className="text-2xl font-semibold tracking-tight">
                Cadastro aguardando aprovação
              </h1>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Seu cadastro foi recebido. Um administrador precisa aprovar antes que você consiga
                entrar. Você será avisado por e-mail (quando configurado).
              </p>
            </>
          ) : status === 'REJECTED' ? (
            <>
              <h1 className="text-2xl font-semibold tracking-tight">Cadastro recusado</h1>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Seu cadastro foi recusado pelo administrador. Entre em contato se acha que houve
                engano.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-semibold tracking-tight">Conta desativada</h1>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Sua conta está desativada. Entre em contato com o administrador.
              </p>
            </>
          )}

          <Button variant="secondary" size="lg" onClick={onSignOut}>
            <LogOut className="h-4 w-4" />
            Sair
          </Button>
        </div>
      </main>
    </div>
  );
}
