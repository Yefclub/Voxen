import type { JobSummary } from '../../lib/types';

export function jobDestination(job: Pick<JobSummary, 'id' | 'transcriptId'>): string {
  return job.transcriptId ? `/transcricoes/${job.transcriptId}` : `/jobs/${job.id}`;
}
