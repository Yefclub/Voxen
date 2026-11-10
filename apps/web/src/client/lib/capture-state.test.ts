import { describe, expect, it } from 'bun:test';
import { parseCaptureSubmit, type CaptureJob } from './capture-api';
import {
  actionForCode,
  applyCaptureEvent,
  canRetry,
  captureLabel,
  mergeCaptures,
  platformLabel,
  readCapturePageIntent,
} from './capture-state';
import { captureStageKey, enJobStageMessages, ptBrJobStageMessages } from './job-stage-i18n';

function job(overrides: Partial<CaptureJob> = {}): CaptureJob {
  return {
    id: 'job1',
    kind: 'link',
    status: 'QUEUED',
    sourceUrl: 'https://www.example.com/post/1/',
    filename: null,
    platform: 'web',
    stage: 'queued',
    percent: 0,
    attempt: 0,
    queuedAt: '2026-11-09T10:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    retryAt: null,
    costUsd: null,
    reprocessOf: null,
    transcript: null,
    error: null,
    ...overrides,
  };
}

describe('parseCaptureSubmit', () => {
  it('distinguishes new and deduped jobs, existing documents and typed errors', () => {
    expect(parseCaptureSubmit(202, { job: job(), deduped: false })).toMatchObject({
      kind: 'job',
      deduped: false,
    });
    expect(parseCaptureSubmit(200, { job: job(), deduped: true })).toMatchObject({
      kind: 'job',
      deduped: true,
    });
    expect(
      parseCaptureSubmit(200, { existing: true, transcript: { id: 't1', title: 'Doc' } }),
    ).toEqual({ kind: 'existing', transcript: { id: 't1', title: 'Doc' } });
    expect(
      parseCaptureSubmit(409, {
        error: {
          code: 'AI_NOT_CONFIGURED',
          message: 'IA não configurada.',
          action: 'configure_ai',
          retryable: false,
          settingsUrl: '/conta/ia',
        },
      }),
    ).toMatchObject({
      kind: 'error',
      status: 409,
      error: { code: 'AI_NOT_CONFIGURED', action: 'configure_ai', settingsUrl: '/conta/ia' },
    });
  });

  it('keeps plain string errors (rate limit) and unreadable bodies as untyped errors', () => {
    expect(parseCaptureSubmit(429, { error: 'Muitas capturas.' })).toEqual({
      kind: 'error',
      status: 429,
      error: null,
      message: 'Muitas capturas.',
    });
    expect(parseCaptureSubmit(500, null)).toMatchObject({ kind: 'error', error: null });
  });
});

describe('applyCaptureEvent', () => {
  const base = { id: 'e1', jobId: 'job1', ts: '2026-11-09T10:00:01.000Z' };

  it('moves through capture stages and keeps the last percent when none is sent', () => {
    let current = applyCaptureEvent(job(), { ...base, stage: 'extracting', percent: 10 });
    expect(current).toMatchObject({ status: 'RUNNING', stage: 'extracting', percent: 10 });
    current = applyCaptureEvent(current, { ...base, stage: 'interpreting' });
    expect(current.percent).toBe(10);
    current = applyCaptureEvent(current, { ...base, stage: 'failed' });
    expect(current.status).toBe('FAILED');
    current = applyCaptureEvent(current, { ...base, stage: 'queued' });
    expect(current).toMatchObject({ status: 'QUEUED', percent: 0 });
  });

  it('ignores events for another job and lets a snapshot replace the job', () => {
    const current = job();
    expect(applyCaptureEvent(current, { ...base, jobId: 'other', stage: 'done' })).toBe(current);
    const snapshot = job({ status: 'DONE', stage: 'done', percent: 100 });
    expect(applyCaptureEvent(current, { snapshot })).toBe(snapshot);
  });
});

describe('capture list and actions', () => {
  it('merges by id, newest first', () => {
    const older = job({ id: 'a', queuedAt: '2026-11-09T09:00:00.000Z' });
    const newer = job({ id: 'b', queuedAt: '2026-11-09T11:00:00.000Z' });
    const merged = mergeCaptures([older], [newer, { ...older, status: 'RUNNING' }]);
    expect(merged.map((item) => [item.id, item.status])).toEqual([
      ['b', 'QUEUED'],
      ['a', 'RUNNING'],
    ]);
  });

  it('offers retry only where it can help', () => {
    const failed = (action: 'retry' | 'upload' | 'configure_ai' | 'edit_url' | 'none') =>
      job({ status: 'FAILED', error: { code: 'X', message: '', action } });
    expect(canRetry(failed('retry'))).toBe(true);
    expect(canRetry(failed('configure_ai'))).toBe(true);
    expect(canRetry(failed('upload'))).toBe(true);
    expect(canRetry(failed('none'))).toBe(false);
    expect(canRetry(job({ status: 'CANCELLED' }))).toBe(true);
    expect(canRetry(job({ status: 'RUNNING' }))).toBe(false);
  });

  it('maps codes without a server description to a next step', () => {
    expect(actionForCode('AI_NOT_CONFIGURED')).toBe('configure_ai');
    expect(actionForCode('STT_NOT_CONFIGURED')).toBe('configure_ai');
    expect(actionForCode('LOGIN_REQUIRED')).toBe('upload');
    expect(actionForCode('SHARE_LOGIN_FILES')).toBe('upload');
    expect(actionForCode('BLOCKED_ADDRESS')).toBe('edit_url');
    expect(actionForCode('REMOVED')).toBe('none');
  });

  it('names platforms for display and hides upload/other', () => {
    expect(platformLabel('tiktok')).toBe('TikTok');
    expect(platformLabel('youtube')).toBe('YouTube');
    expect(platformLabel('upload')).toBeNull();
    expect(platformLabel(null)).toBeNull();
  });

  it('labels jobs by document title, file name, then link', () => {
    expect(captureLabel(job())).toBe('example.com/post/1');
    expect(captureLabel(job({ kind: 'upload', sourceUrl: null, filename: 'nota.md' }))).toBe(
      'nota.md',
    );
    expect(
      captureLabel(job({ transcript: { id: 't', title: 'Título', method: null, model: null } })),
    ).toBe('Título');
  });
});

describe('capture page intent', () => {
  it('accepts only known codes, safe ids and http(s) shared links', () => {
    const intent = readCapturePageIntent(
      new URLSearchParams({
        job: 'cm123abc',
        error: 'AI_NOT_CONFIGURED',
        shared: 'https://youtu.be/dQw4w9WgXcQ',
      }),
    );
    expect(intent).toEqual({
      focusJobId: 'cm123abc',
      existingTranscriptId: null,
      error: 'AI_NOT_CONFIGURED',
      sharedUrl: 'https://youtu.be/dQw4w9WgXcQ',
    });
    expect(
      readCapturePageIntent(
        new URLSearchParams({
          job: '../../x',
          existing: '<script>',
          error: '<b>hi</b>',
          shared: 'javascript:alert(1)',
        }),
      ),
    ).toEqual({ focusJobId: null, existingTranscriptId: null, error: null, sharedUrl: null });
  });
});

describe('capture stage labels', () => {
  it('labels every stage the capture runner publishes in both locales', () => {
    for (const [stage, key] of [
      ['extracting', 'job.stage.extracting'],
      ['transcribing', 'job.stage.transcribing'],
      ['describing_images', 'job.stage.describingImages'],
      ['interpreting', 'job.stage.interpreting'],
      ['publishing', 'job.stage.publishing'],
    ] as const) {
      expect(captureStageKey(stage)).toBe(key);
    }
    for (const key of [
      'job.stage.extracting',
      'job.stage.describingImages',
      'job.stage.interpreting',
      'job.stage.publishing',
    ] as const) {
      expect(ptBrJobStageMessages[key]).toBeTruthy();
      expect(enJobStageMessages[key]).toBeTruthy();
    }
    expect(captureStageKey('something_new')).toBe('job.stage.running');
  });
});
