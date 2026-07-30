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
    expect(chat).not.toContain('max-w-5xl');
    expect(chat.match(/max-w-3xl/gu)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(chat).toContain('chat-response-markdown');
    expect(chat).toContain('[&_p]:max-w-3xl');
  });
});
