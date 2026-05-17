import { Button } from './components/ui/button';

export function App(): React.ReactElement {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-zinc-100 text-sm font-bold text-zinc-900">
              V
            </div>
            <span className="text-lg font-semibold tracking-tight">Voxen</span>
          </div>
          <nav className="flex items-center gap-2">
            <Button variant="ghost" size="sm">
              Entrar
            </Button>
            <Button size="sm">Cadastrar</Button>
          </nav>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center px-6 py-16">
        <h1 className="text-balance text-center text-4xl font-semibold tracking-tight md:text-5xl">
          Sua knowledge base de vídeos,
          <br />
          <span className="text-zinc-400">navegada por um agente.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-balance text-center text-base text-zinc-400 md:text-lg">
          Cole um link do YouTube, o Voxen transcreve e indexa. Depois, converse com seu acervo.
        </p>
        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Button size="lg">Começar</Button>
          <Button size="lg" variant="outline">
            Saber mais
          </Button>
        </div>
        <div className="mt-16 text-sm text-zinc-500">
          UI em construção — as telas funcionais virão nas próximas PRs.
        </div>
      </main>

      <footer className="border-t border-zinc-800">
        <div className="mx-auto max-w-6xl px-6 py-6 text-center text-xs text-zinc-500">
          Voxen — self-hosted, sem embeddings, sem hype.
        </div>
      </footer>
    </div>
  );
}
