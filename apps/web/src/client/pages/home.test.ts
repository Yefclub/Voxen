import { describe, expect, it } from 'bun:test';
import { jobDestination } from './home';

describe('jobDestination', () => {
  it('abre a transcrição quando o job concluído possui transcriptId', () => {
    expect(jobDestination({ id: 'job-1', transcriptId: 'transcript-1' })).toBe(
      '/transcricoes/transcript-1',
    );
  });

  it('mantém o usuário no detalhe do job enquanto não houver transcrição', () => {
    expect(jobDestination({ id: 'job-2', transcriptId: null })).toBe('/jobs/job-2');
  });
});
