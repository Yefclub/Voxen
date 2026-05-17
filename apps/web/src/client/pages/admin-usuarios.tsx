import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';
import { Badge } from '../components/ui/badge';
import { Spinner } from '../components/ui/spinner';
import { apiPost } from '../lib/api';
import { useFetch } from '../lib/hooks';
import type { AdminUser } from '../lib/types';
import { formatRelative } from '../lib/format';

export function AdminUsuariosPage(): React.ReactElement {
  const { data, loading, refresh } = useFetch<{ users: AdminUser[] }>('/api/admin/usuarios');
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function approve(id: string): Promise<void> {
    setPendingId(id);
    try {
      await apiPost(`/api/admin/usuarios/${id}/approve`, {});
      refresh();
    } finally {
      setPendingId(null);
    }
  }

  async function reject(id: string): Promise<void> {
    setPendingId(id);
    try {
      await apiPost(`/api/admin/usuarios/${id}/reject`, {});
      refresh();
    } finally {
      setPendingId(null);
    }
  }

  const users = data?.users ?? [];
  const pending = users.filter((u) => u.status === 'PENDING');
  const others = users.filter((u) => u.status !== 'PENDING');

  return (
    <div className="px-8 py-10 mx-auto max-w-6xl space-y-8">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wider text-zinc-500 font-medium">Administração</p>
        <h1 className="text-3xl font-semibold tracking-tight">Usuários</h1>
        <p className="text-sm text-zinc-400 mt-2">Aprove novos cadastros e gerencie permissões.</p>
      </header>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold tracking-tight text-zinc-300">
          Aguardando aprovação
          {pending.length > 0 && (
            <Badge variant="warning" className="ml-2">
              {pending.length}
            </Badge>
          )}
        </h2>

        {loading && <Skeleton className="h-32 w-full" />}

        {!loading && pending.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-zinc-500">
              Nenhum cadastro pendente.
            </CardContent>
          </Card>
        )}

        {!loading && pending.length > 0 && (
          <Card>
            <ul className="divide-y divide-zinc-800/80">
              {pending.map((u) => (
                <li
                  key={u.id}
                  className="flex items-center gap-4 px-5 py-4 hover:bg-zinc-900/40 transition-colors"
                >
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-zinc-100">{u.name}</span>
                      <span className="text-sm text-zinc-500">{u.email}</span>
                    </div>
                    <p className="text-xs text-zinc-500">
                      Cadastrou-se {formatRelative(new Date(u.createdAt))}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={pendingId === u.id}
                      onClick={() => reject(u.id)}
                    >
                      {pendingId === u.id ? <Spinner /> : <X className="h-3.5 w-3.5" />}
                      Recusar
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={pendingId === u.id}
                      onClick={() => approve(u.id)}
                    >
                      {pendingId === u.id ? <Spinner /> : <Check className="h-3.5 w-3.5" />}
                      Aprovar
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold tracking-tight text-zinc-300">Todos os usuários</h2>

        {!loading && others.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-zinc-500">
              Você é o primeiro usuário do sistema.
            </CardContent>
          </Card>
        )}

        {!loading && others.length > 0 && (
          <Card>
            <ul className="divide-y divide-zinc-800/80">
              {others.map((u) => (
                <li
                  key={u.id}
                  className="flex items-center gap-4 px-5 py-4 hover:bg-zinc-900/40 transition-colors"
                >
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-medium text-zinc-100">{u.name}</span>
                      <span className="text-sm text-zinc-500">{u.email}</span>
                      {u.role === 'ADMIN' && (
                        <Badge variant="success" className="text-[10px]">
                          Admin
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500">
                      {u.status === 'APPROVED' && u.approvedAt
                        ? `Aprovado ${formatRelative(new Date(u.approvedAt))}`
                        : u.status === 'REJECTED'
                          ? 'Cadastro recusado'
                          : 'Desativado'}
                    </p>
                  </div>
                  <StatusBadge status={u.status} />
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: AdminUser['status'] }): React.ReactElement {
  if (status === 'APPROVED') return <Badge variant="success">Ativo</Badge>;
  if (status === 'PENDING') return <Badge variant="warning">Pendente</Badge>;
  if (status === 'REJECTED') return <Badge variant="danger">Recusado</Badge>;
  return <Badge variant="muted">Desativado</Badge>;
}
