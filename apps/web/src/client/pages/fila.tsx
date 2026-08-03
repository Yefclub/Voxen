import { ListOrdered } from '@/components/ui/icons';
import { JobsQueueSection } from '../components/ingest/jobs-queue-section';
import { PageHeader, PageShell } from '../components/ui/page-shell';
import { useI18n } from '../lib/i18n';

export function FilaPage(): React.ReactElement {
  const { t } = useI18n();

  return (
    <PageShell width="wide">
      <PageHeader
        eyebrow={t('shell.nav.queue')}
        icon={ListOrdered}
        iconClassName="text-sky-400"
        title={<span id="fila-title">{t('jobs.queueTitle')}</span>}
      />

      <JobsQueueSection showHeading={false} />
    </PageShell>
  );
}
