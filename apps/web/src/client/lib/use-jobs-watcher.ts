import { useEffect } from 'react';
import { toast } from 'sonner';
import { useI18n, type TranslateFn } from './i18n';

interface JobEvent {
  jobId: string;
  stage: string;
  percent?: number;
  transcriptId?: string;
  errorMsg?: string;
  ts: string;
}

interface JobListItem {
  id: string;
  status: string;
  transcriptId?: string | null;
  errorMsg?: string | null;
}

interface JobsResponse {
  jobs: JobListItem[];
}

const JOBS_WATCHER_POLL_MS = 10_000;

/**
 * Hook global: consulta jobs recentes e dispara toasts quando jobs terminam em
 * qualquer página da aplicação. Polling evita o ERR_HTTP2_PROTOCOL_ERROR que
 * alguns proxies em HTTP/2 ainda geram em EventSource de longa duração.
 */
export function useJobsWatcher(enabled: boolean, onNavigate: (path: string) => void): void {
  const { t } = useI18n();

  useEffect(() => {
    if (!enabled) return;
    const seen = new Set<string>();
    let initialized = false;
    let stopped = false;
    const controller = new AbortController();

    const poll = async () => {
      if (stopped) return;
      let payload: JobsResponse;
      try {
        const res = await fetch('/api/jobs', {
          credentials: 'include',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        if (!res.ok) return;
        payload = (await res.json()) as JobsResponse;
      } catch {
        return;
      }

      for (const job of payload.jobs) {
        const stage = terminalStage(job.status);
        if (!stage) continue;
        const key = `${job.id}:${stage}`;
        if (!initialized) {
          seen.add(key);
          continue;
        }
        if (seen.has(key)) continue;
        seen.add(key);
        notifyTerminalJob(
          {
            jobId: job.id,
            stage,
            transcriptId: job.transcriptId ?? undefined,
            errorMsg: job.errorMsg ?? undefined,
            ts: new Date().toISOString(),
          },
          t,
          onNavigate,
        );
      }
      initialized = true;
    };

    void poll();
    const interval = setInterval(() => {
      void poll();
    }, JOBS_WATCHER_POLL_MS);

    return () => {
      stopped = true;
      controller.abort();
      clearInterval(interval);
    };
  }, [enabled, onNavigate, t]);
}

function terminalStage(status: string): JobEvent['stage'] | null {
  if (status === 'DONE') return 'done';
  if (status === 'FAILED') return 'failed';
  if (status === 'CANCELLED') return 'cancelled';
  return null;
}

function notifyTerminalJob(
  evt: JobEvent,
  t: TranslateFn,
  onNavigate: (path: string) => void,
): void {
  if (evt.stage === 'done') {
    toast.success(t('job.toast.ready'), {
      description: t('job.toast.readyDescription'),
      action: evt.transcriptId
        ? {
            label: t('common.open'),
            onClick: () => onNavigate(`/transcricoes/${evt.transcriptId}`),
          }
        : undefined,
    });
    return;
  }
  if (evt.stage === 'failed') {
    toast.error(t('job.toast.failed'), {
      description: evt.errorMsg ?? t('job.toast.failedDescription'),
      action: {
        label: t('job.toast.view'),
        onClick: () => onNavigate(`/jobs/${evt.jobId}`),
      },
    });
    return;
  }
  if (evt.stage === 'cancelled') {
    toast(t('job.toast.cancelled'));
  }
}
