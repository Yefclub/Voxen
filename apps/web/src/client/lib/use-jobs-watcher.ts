import { useEffect } from 'react';
import { toast } from 'sonner';
import { useI18n } from './i18n';

interface JobEvent {
  jobId: string;
  stage: string;
  percent?: number;
  transcriptId?: string;
  errorMsg?: string;
  ts: string;
}

/**
 * Hook global: monta um EventSource em /api/jobs/events/me e dispara
 * toasts quando jobs terminam (done / failed / cancelled) em qualquer
 * página da aplicação. Deduplica eventos por (jobId, stage).
 */
export function useJobsWatcher(enabled: boolean, onNavigate: (path: string) => void): void {
  const { t } = useI18n();

  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource('/api/jobs/events/me', { withCredentials: true });
    const seen = new Set<string>();

    es.addEventListener('progress', (raw) => {
      const e = raw as MessageEvent<string>;
      let evt: JobEvent;
      try {
        evt = JSON.parse(e.data) as JobEvent;
      } catch {
        return;
      }
      const key = `${evt.jobId}:${evt.stage}`;
      if (seen.has(key)) return;
      // Só interessa toast em stages terminais.
      if (evt.stage === 'done') {
        seen.add(key);
        toast.success(t('job.toast.ready'), {
          description: t('job.toast.readyDescription'),
          action: evt.transcriptId
            ? {
                label: t('common.open'),
                onClick: () => onNavigate(`/transcricoes/${evt.transcriptId}`),
              }
            : undefined,
        });
      } else if (evt.stage === 'failed') {
        seen.add(key);
        toast.error(t('job.toast.failed'), {
          description: evt.errorMsg ?? t('job.toast.failedDescription'),
          action: {
            label: t('job.toast.view'),
            onClick: () => onNavigate(`/jobs/${evt.jobId}`),
          },
        });
      } else if (evt.stage === 'cancelled') {
        seen.add(key);
        toast(t('job.toast.cancelled'));
      }
    });

    es.addEventListener('error', () => {
      // EventSource reconecta automaticamente; só fechar se foi explícito
    });

    return () => {
      es.close();
    };
  }, [enabled, onNavigate, t]);
}
