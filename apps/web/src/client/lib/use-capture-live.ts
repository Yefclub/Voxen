// ============================================================================
// useCaptureLive — follows one capture job over SSE (spec 220)
// ============================================================================
// The browser resends Last-Event-ID on its own reconnects. When the stream is
// closed for good (HTTP error, server restart) we reopen it with backoff and
// pass the last seen id as `?lastEventId=` so the server replays only what was
// missed. A terminal stage closes the stream and refetches the job, because
// live events carry no error details, cost or document link.
// ============================================================================

import { useEffect, useRef } from 'react';
import { fetchCapture, type CaptureJob, type CaptureProgressEvent } from './capture-api';
import { applyCaptureEvent, isActiveCapture, isTerminalStage } from './capture-state';

const MAX_BACKOFF_MS = 30_000;

export function useCaptureLive(
  job: CaptureJob,
  enabled: boolean,
  onChange: (job: CaptureJob) => void,
): void {
  const jobRef = useRef(job);
  jobRef.current = job;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const lastEventId = useRef<string | null>(null);
  const active = isActiveCapture(job);

  useEffect(() => {
    if (!enabled || !active || typeof EventSource === 'undefined') return;
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    let stopped = false;

    const close = (): void => {
      source?.close();
      source = null;
    };

    const settle = async (): Promise<void> => {
      close();
      const fresh = await fetchCapture(jobRef.current.id).catch(() => null);
      if (stopped) return;
      if (fresh) onChangeRef.current(fresh);
      // A replayed terminal event from an earlier attempt: keep following.
      if (fresh && isActiveCapture(fresh)) connect();
    };

    const scheduleReconnect = (): void => {
      close();
      if (stopped || timer) return;
      const delay = Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** failures);
      failures += 1;
      timer = setTimeout(() => {
        timer = null;
        connect();
      }, delay);
    };

    function connect(): void {
      if (stopped) return;
      const base = `/api/captures/${encodeURIComponent(jobRef.current.id)}/events`;
      const url = lastEventId.current
        ? `${base}?lastEventId=${encodeURIComponent(lastEventId.current)}`
        : base;
      const es = new EventSource(url, { withCredentials: true });
      source = es;
      es.addEventListener('open', () => {
        failures = 0;
      });
      es.addEventListener('progress', (message) => {
        const event = message as MessageEvent<string>;
        let data: CaptureProgressEvent;
        try {
          data = JSON.parse(event.data) as CaptureProgressEvent;
        } catch {
          return;
        }
        if (event.lastEventId) lastEventId.current = event.lastEventId;
        if ('snapshot' in data) {
          close();
          onChangeRef.current(data.snapshot);
          return;
        }
        const next = applyCaptureEvent(jobRef.current, data);
        jobRef.current = next;
        onChangeRef.current(next);
        if (isTerminalStage(data.stage)) void settle();
      });
      es.addEventListener('error', () => {
        if (es.readyState === EventSource.CLOSED) scheduleReconnect();
      });
    }

    connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      close();
    };
    // Reconnect only when the job identity or its active state changes.
  }, [job.id, enabled, active]);
}
