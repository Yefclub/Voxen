import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CLIENT_ROOT = join(import.meta.dir, '../src/client');

function read(path: string): string {
  return readFileSync(join(CLIENT_ROOT, path), 'utf8');
}

describe('regressões de interface confirmadas em produção', () => {
  test('editor de notas empilha título e ações no mobile sem largura intrínseca excedente', () => {
    const notes = read('pages/notas.tsx');
    expect(notes).toContain('data-note-editor-toolbar');
    expect(notes).toContain('flex-col');
    expect(notes).toContain('sm:flex-row');
    expect(notes).toContain('min-w-0');
  });

  test('notas revalidam ao entrar ou retornar à aba e abrem em Preview', () => {
    const notes = read('pages/notas.tsx');
    const notesStore = read('lib/use-notes.ts');
    expect(notes).toContain('void refresh();');
    expect(notes).toContain("window.addEventListener('focus', revalidateWhenVisible)");
    expect(notes).toContain("document.addEventListener('visibilitychange', revalidateWhenVisible)");
    expect(notes).toContain('const [previewMode, setPreviewMode] = useState(true);');
    expect(notes).toContain('key={id}');
    expect(notes).toContain('<h2 className="min-w-0 flex-1 truncate');
    expect(notesStore).toContain('createLatestOnlyRevalidator');
    expect(notesStore).toContain('requestId === latestRequestId || applyWhenStale(next)');
    expect(notesStore).toContain(
      'if (next !== null && (requestId === latestRequestId || applyWhenStale(next)))',
    );
    expect(notesStore).toContain('accessRevoked: true');
    expect(notesStore).toContain('(result) => result.accessRevoked');
    expect(notesStore).toContain('if (isInitialLoad) setLoading(true);');
    expect(notes).toContain('if (notesLoading || revalidationStarted.current) return;');
    expect(notes).toContain('if (enteredWithInitialLoad.current) return;');
    expect(notes).toContain('focusRefreshInFlight');
  });

  test('detalhe de job volta para a fila e possui heading principal', () => {
    const jobs = read('pages/jobs-detalhe.tsx');
    expect(jobs).toContain('<Link to="/fila">');
    expect(jobs).toContain('<h1');
    expect(jobs).not.toContain('<Link to="/">');
  });

  test('novidades não duplica retorno inline e flutuante no mobile', () => {
    const news = read('pages/novidades.tsx');
    expect(news).toContain('className="hidden md:inline-flex"');
  });

  test('troca de rota usa o location atual sem snapshot visual intermediário', () => {
    const app = read('App.tsx');
    const layout = read('components/layout/app-layout.tsx');
    expect(app).not.toContain('displayLocation');
    expect(app).not.toContain('flushSync');
    expect(app).toContain('<Routes>');
    expect(layout).toContain("if (isChatRoute(pathname)) return 'chat'");
  });

  test('reset de scroll ocorre antes da pintura e apenas ao trocar de seção', () => {
    const layout = read('components/layout/app-layout.tsx');
    expect(layout).toContain('useLayoutEffect');
    expect(layout).toContain('[sectionKey]');
    expect(layout).not.toContain('[location.pathname]');
  });

  test('fallback lazy preserva uma superfície local em vez de spinner central', () => {
    const layout = read('components/layout/app-layout.tsx');
    expect(layout).toContain('data-route-loading');
    expect(layout).not.toContain(
      'className="flex h-full min-h-48 items-center justify-center p-6"',
    );
  });

  test('chat mantém histórico, prosa e composer na mesma coluna legível', () => {
    const chat = read('pages/chat.tsx');
    const styles = read('index.css');
    expect(chat).not.toContain('max-w-5xl');
    expect(chat.match(/max-w-3xl/gu)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(chat).toContain('chat-response-markdown');
    expect(chat).toContain('[&_p]:max-w-3xl');
    expect(styles).toContain(".chat-response-markdown [data-horizontal-scroll='true']");
    expect(styles).toContain('width: min(64rem, calc(100vw - 24rem))');
  });
});
