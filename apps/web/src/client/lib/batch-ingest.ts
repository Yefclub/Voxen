export const MAX_BATCH_URLS = 20;

export type BatchIngestOutcome =
  | 'created'
  | 'existing_transcript'
  | 'inflight'
  | 'invalid'
  | 'setup_incomplete'
  | 'error';

export type BatchIngestItem = {
  index: number;
  input: string;
  result: {
    outcome: BatchIngestOutcome;
    error?: string;
    jobId?: string;
    transcriptId?: string;
    sourceUrl?: string;
  };
};

export function parseBatchUrls(value: string): string[] {
  return value
    .split(/\s+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}
