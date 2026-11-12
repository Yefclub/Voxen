import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { CaptureJob } from './capture-api';
import { useCaptureLive } from './use-capture-live';

const originalFetch = globalThis.fetch;
const originalSource = globalThis.EventSource;
const originalAct = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
const sources: TestSource[] = [];
let renderer: ReactTestRenderer | null = null;
let resolveSnapshot: (response: Response) => void;
const changed = mock((_job: CaptureJob) => undefined);
const job: CaptureJob = {
  id: 'foreground',
  kind: 'link',
  status: 'RUNNING',
  sourceUrl: 'https://example.com/source',
  filename: null,
  platform: 'web',
  warnings: [],
  stage: 'interpreting',
  percent: 80,
  attempt: 1,
  queuedAt: '2026-11-12T10:00:00Z',
  startedAt: '2026-11-12T10:00:01Z',
  finishedAt: null,
  retryAt: null,
  costUsd: null,
  reprocessOf: null,
  transcript: null,
  error: null,
};

class TestSource {
  static CLOSED = 2;
  readyState = 1;
  listeners = new Map<string, (event: object) => void>();
  constructor() {
    sources.push(this);
  }
  addEventListener(type: string, callback: (event: object) => void): void {
    this.listeners.set(type, callback);
  }
  close(): void {
    this.readyState = TestSource.CLOSED;
  }
  progress(stage: string): void {
    this.listeners.get('progress')?.({
      data: JSON.stringify({ id: 'event-1', jobId: job.id, stage, ts: '2026-11-12T10:00:02Z' }),
      lastEventId: 'event-1',
    });
  }
}

function Harness(): React.ReactElement {
  const [current, setCurrent] = useState(job);
  useCaptureLive(current, true, (next) => {
    changed(next);
    setCurrent(next);
  });
  return React.createElement('output', { 'data-document': current.transcript?.id }, current.status);
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    configurable: true,
    writable: true,
    value: true,
  });
  sources.length = 0;
  changed.mockClear();
  globalThis.EventSource = TestSource as unknown as typeof EventSource;
  globalThis.fetch = mock(
    () =>
      new Promise<Response>((resolve) => {
        resolveSnapshot = resolve;
      }),
  ) as unknown as typeof fetch;
});
afterEach(async () => {
  if (renderer) await act(async () => renderer?.unmount());
  renderer = null;
  globalThis.fetch = originalFetch;
  globalThis.EventSource = originalSource;
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', originalAct);
});

describe('foreground capture completion', () => {
  test('ignores progress and snapshots for a different capture', async () => {
    await act(async () => {
      renderer = create(React.createElement(Harness));
    });
    await act(async () => {
      sources[0]!.listeners.get('progress')?.({
        data: JSON.stringify({ jobId: 'another-job', stage: 'done' }),
      });
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    await act(async () => {
      sources[0]!.listeners.get('progress')?.({
        data: JSON.stringify({ snapshot: { ...job, id: 'another-job', status: 'DONE' } }),
      });
    });
    expect(changed).not.toHaveBeenCalled();
  });

  test('keeps following until the terminal event resolves to a document snapshot', async () => {
    await act(async () => {
      renderer = create(React.createElement(Harness));
    });
    await act(async () => {
      sources[0]!.progress('done');
    });
    expect(changed).not.toHaveBeenCalled();
    const completed: CaptureJob = {
      ...job,
      status: 'DONE',
      stage: 'done',
      percent: 100,
      finishedAt: '2026-11-12T10:00:02Z',
      transcript: { id: 'document-1', title: 'Analyzed source', method: 'SCRAPE', model: null },
    };
    await act(async () => {
      resolveSnapshot(Response.json({ capture: completed }));
    });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(renderer!.root.findByType('output').props['data-document']).toBe('document-1');
    expect(sources[0]!.readyState).toBe(TestSource.CLOSED);
  });

  test('ignores a completed snapshot after the foreground view unmounts', async () => {
    await act(async () => {
      renderer = create(React.createElement(Harness));
    });
    await act(async () => {
      sources[0]!.progress('done');
    });
    await act(async () => {
      renderer?.unmount();
      renderer = null;
    });
    changed.mockClear();
    await act(async () => {
      resolveSnapshot(
        Response.json({
          capture: { ...job, status: 'DONE', transcript: { id: 'stale-document' } },
        }),
      );
    });
    expect(changed).not.toHaveBeenCalled();
  });

  test('keeps following a retry when an older terminal event is replayed', async () => {
    await act(async () => {
      renderer = create(React.createElement(Harness));
    });
    await act(async () => {
      sources[0]!.progress('done');
    });
    await act(async () => {
      resolveSnapshot(Response.json({ capture: job }));
    });
    expect(renderer!.root.findByType('output').children).toEqual(['RUNNING']);
    expect(sources).toHaveLength(2);
  });

  test('keeps an active snapshot stream open for subsequent progress', async () => {
    await act(async () => {
      renderer = create(React.createElement(Harness));
    });
    await act(async () => {
      sources[0]!.listeners.get('progress')?.({ data: JSON.stringify({ snapshot: job }) });
    });
    expect(sources[0]!.readyState).toBe(1);
    expect(renderer!.root.findByType('output').children).toEqual(['RUNNING']);
  });

  test('reconnects when the terminal document snapshot is temporarily unavailable', async () => {
    await act(async () => {
      renderer = create(React.createElement(Harness));
    });
    await act(async () => {
      sources[0]!.progress('done');
    });
    await act(async () => {
      resolveSnapshot(new Response(null, { status: 503 }));
    });
    await act(async () => {
      await Bun.sleep(1050);
    });
    expect(sources).toHaveLength(2);
    expect(renderer!.root.findByType('output').children).toEqual(['RUNNING']);
  });
});
