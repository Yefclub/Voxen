import { describe, expect, test } from 'bun:test';
import { getTranscriptEnrichmentStaleReason } from './transcript-enrichments';

const transcript = { sourceVersion: 3, sourceChecksum: 'sha256:current' };
const enrichment = {
  staleReason: null,
  sourceVersion: 3,
  sourceChecksum: 'sha256:current',
  expiresAt: new Date('2026-08-08T00:00:00.000Z'),
};

describe('getTranscriptEnrichmentStaleReason', () => {
  test('keeps a current, unexpired enrichment fresh', () => {
    expect(
      getTranscriptEnrichmentStaleReason(
        enrichment,
        transcript,
        new Date('2026-08-07T00:00:00.000Z'),
      ),
    ).toBeNull();
  });

  test('rejects source revisions and checksum changes', () => {
    expect(
      getTranscriptEnrichmentStaleReason(
        { ...enrichment, sourceVersion: 2 },
        transcript,
        new Date('2026-08-07T00:00:00.000Z'),
      ),
    ).toBe('source-version-changed');
    expect(
      getTranscriptEnrichmentStaleReason(
        { ...enrichment, sourceChecksum: 'sha256:old' },
        transcript,
        new Date('2026-08-07T00:00:00.000Z'),
      ),
    ).toBe('source-version-changed');
  });

  test('rejects expired research without requiring a prior list request', () => {
    expect(
      getTranscriptEnrichmentStaleReason(
        enrichment,
        transcript,
        new Date('2026-08-09T00:00:00.000Z'),
      ),
    ).toBe('research-expired');
  });

  test('preserves an existing stale reason', () => {
    expect(
      getTranscriptEnrichmentStaleReason(
        { ...enrichment, staleReason: 'manually-invalidated' },
        transcript,
        new Date('2026-08-07T00:00:00.000Z'),
      ),
    ).toBe('manually-invalidated');
  });
});
