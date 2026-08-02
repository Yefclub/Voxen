import { useEffect, useRef } from 'react';
import { toast } from './toast';
import { useI18n, type TranslateFn } from './i18n';
import {
  buildJobSystemNotification,
  ensureNotificationPermission,
  readNotificationPermission,
  resolveTerminalJobFeedback,
  showSystemNotification,
  type TerminalJobStage,
} from './job-terminal-feedback';

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
 * Hook global: consulta jobs recentes e dispara feedback quando jobs terminam
 * em qualquer página. Polling evita o ERR_HTTP2_PROTOCOL_ERROR que alguns
 * proxies em HTTP/2 ainda geram em EventSource de longa duração.
 *
 * Visível → toast in-app. Hidden + permission → notificação de sistema (L1).
 */
export function useJobsWatcher(enabled: boolean, onNavigate: (path: string) => void): void {
  const { t } = useI18n();
  const onNavigateRef = useRef(onNavigate);
  const translateRef = useRef(t);
  onNavigateRef.current = onNavigate;
  translateRef.current = t;

  useEffect(() => {
    if (!enabled) return;
    const seen = new Set<string>();
    let initialized = false;
    let stopped = false;
    let polling = false;
    const controller = new AbortController();

    const poll = async () => {
      if (stopped || polling) return;
      polling = true;
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
      } finally {
        polling = false;
      }

      if (stopped) return;
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
        await notifyTerminalJob(
          {
            jobId: job.id,
            stage,
            transcriptId: job.transcriptId ?? undefined,
            errorMsg: job.errorMsg ?? undefined,
            ts: new Date().toISOString(),
          },
          translateRef.current,
          onNavigateRef.current,
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
  }, [enabled]);
}

function terminalStage(status: string): TerminalJobStage | null {
  if (status === 'DONE') return 'done';
  if (status === 'FAILED') return 'failed';
  if (status === 'CANCELLED') return 'cancelled';
  return null;
}

async function notifyTerminalJob(
  evt: JobEvent & { stage: TerminalJobStage },
  t: TranslateFn,
  onNavigate: (path: string) => void,
): Promise<void> {
  const documentHidden = typeof document !== 'undefined' ? Boolean(document.hidden) : false;

  let permission = readNotificationPermission();
  if (
    documentHidden &&
    permission === 'default' &&
    (evt.stage === 'done' || evt.stage === 'failed')
  ) {
    permission = await ensureNotificationPermission();
  }

  const channel = resolveTerminalJobFeedback({
    stage: evt.stage,
    documentHidden,
    notificationPermission: permission,
  });

  if (channel === 'none') return;

  if (channel === 'notification' && (evt.stage === 'done' || evt.stage === 'failed')) {
    const content = buildJobSystemNotification({
      stage: evt.stage,
      jobId: evt.jobId,
      transcriptId: evt.transcriptId,
      errorMsg: evt.errorMsg,
      labels: {
        readyTitle: t('job.toast.ready'),
        readyBody: t('job.toast.readyDescription'),
        failedTitle: t('job.toast.failed'),
        failedBody: t('job.toast.failedDescription'),
      },
    });
    const shown = await showSystemNotification(content);
    if (shown) return;
    // Fall through to toast only if still visible (permission edge cases).
    if (documentHidden) return;
  }

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
