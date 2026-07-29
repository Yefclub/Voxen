import { ListOrdered } from '@/components/ui/icons';
import { AnimatedPage } from '../components/motion/animated-page';
import { JobsQueueSection } from '../components/ingest/jobs-queue-section';
import { useI18n } from '../lib/i18n';

export function FilaPage(): React.ReactElement {
  const { t } = useI18n();

  return (
    <AnimatedPage>
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
        <header className="space-y-1">
          <div className="inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--color-app-muted)]">
            <ListOrdered className="h-3 w-3 text-[var(--color-app-muted)]" />
            {t('shell.nav.queue')}
          </div>
          <h1
            id="fila-title"
            className="font-display text-xl font-semibold tracking-tight sm:text-2xl"
          >
            {t('jobs.queueTitle')}
          </h1>
        </header>

        <JobsQueueSection showHeading={false} />
      </div>
    </AnimatedPage>
  );
}
