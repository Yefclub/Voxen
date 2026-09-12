import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { requestLogging } from '../src/lib/request-logging';
import { buildStructuredLogEvent, validCorrelationId } from '../src/lib/structured-log';

describe('structured application logs', () => {
  it('builds one safe event with stable operational fields', () => {
    const event = buildStructuredLogEvent(
      'error',
      'job-failed',
      {
        job_id: 'job-1',
        error_code: 'SOURCE_URL_INVALID',
        status_code: 502,
        payload: 'must never be logged',
        secret_value: 'must never be logged',
        detail: 'bounded\nvalue',
      },
      new Date('2026-08-15T12:00:00.000Z'),
    );

    expect(event).toMatchObject({
      timestamp: '2026-08-15T12:00:00.000Z',
      level: 'error',
      service: 'voxen-web',
      event: 'job-failed',
      job_id: 'job-1',
      error_code: 'SOURCE_URL_INVALID',
      status_code: 502,
      detail: 'bounded value',
    });
    expect(event).not.toHaveProperty('payload');
    expect(event).not.toHaveProperty('secret_value');
  });

  it('accepts only bounded request correlation identifiers', () => {
    expect(validCorrelationId('req_123:abc')).toBe('req_123:abc');
    expect(validCorrelationId('contains spaces')).toBeNull();
    expect(validCorrelationId('x'.repeat(129))).toBeNull();
  });

  it('preserves a valid request id and replaces an invalid one', async () => {
    const app = new Hono();
    app.use('*', requestLogging);
    app.get('/health', (c) => c.json({ ok: true }));

    const preserved = await app.request('/health', { headers: { 'x-request-id': 'request-123' } });
    const replaced = await app.request('/health', { headers: { 'x-request-id': 'not valid' } });

    expect(preserved.headers.get('x-request-id')).toBe('request-123');
    expect(replaced.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });
});
