import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const clientRoot = join(import.meta.dir, '../src/client');

function read(relativePath: string): string {
  return readFileSync(join(clientRoot, relativePath), 'utf8');
}

describe('estabilidade do runtime de jobs', () => {
  test('revalidação da Fila preserva os dados já renderizados', () => {
    const source = read('components/ingest/jobs-queue-section.tsx');

    expect(source).toContain('loading && !currentData');
    expect(source).toContain('currentData && jobs.length > 0');
    expect(source).toContain('reconcileJobSummaries(previous, currentData.jobs)');
    expect(source).toContain('const JobRow = memo(function JobRow');
    expect(source).toContain('closedJobStreams.size');
    expect(source).toContain('onStreamStateChange={reportStreamState}');
    expect(source).toContain('createDeferredJobRefresh()');
    expect(source).toContain('jobProgressSnapshot(job)');
    expect(source).toContain(
      '[job.id, job.progressedAt, job.progressPercent, job.progressStage, job.status]',
    );
    expect(source).toContain("document.visibilityState === 'hidden' || !navigator.onLine");
    expect(source).not.toContain('}, 6_000)');
  });

  test('watcher global não reinicia por identidade de tradução ou navegação', () => {
    const watcher = read('lib/use-jobs-watcher.ts');
    const layout = read('components/layout/app-layout.tsx');

    expect(watcher).toContain('const onNavigateRef = useRef(onNavigate)');
    expect(watcher).toContain('const translateRef = useRef(t)');
    expect(watcher).toContain('}, [enabled])');
    expect(watcher).toContain('if (stopped) return');
    expect(layout).toContain('const navigateFromNotification = useCallback');
    expect(layout).toContain('useJobsWatcher(');
    expect(layout).toContain('navigateFromNotification');
  });

  test('watcher roteia feedback terminal: toast visível, notificação com documento hidden', () => {
    const watcher = read('lib/use-jobs-watcher.ts');
    expect(watcher).toContain('resolveTerminalJobFeedback');
    expect(watcher).toContain('showSystemNotification');
    expect(watcher).toContain('ensureNotificationPermission');
    expect(watcher).toContain('documentHidden');
  });

  test('detalhe do job auto-abre a transcrição no DONE focado', () => {
    const detail = read('pages/jobs-detalhe.tsx');
    expect(detail).toContain('shouldAutoOpenTranscript');
    expect(detail).toContain('sawActiveRef');
    expect(detail).toContain('navigate(target, { replace: true })');
  });
});
