import { describe, expect, test } from 'bun:test';
import { renderResearchArtifact, type ArtifactCitation } from '../src/lib/research-artifacts';

const evidence: ArtifactCitation[] = [
  {
    sourceType: 'TRANSCRIPT',
    sourceId: 't1',
    title: 'Fonte segura',
    quote: 'Um trecho verificável da fonte.',
    fromLine: 3,
    toLine: 5,
    href: '/transcricoes/t1#l=3',
    verified: true,
  },
];

describe('artefatos de pesquisa', () => {
  for (const type of ['BRIEFING', 'FAQ', 'STUDY_GUIDE', 'TIMELINE', 'MIND_MAP'] as const) {
    test(`${type} preserva a evidência navegável`, () => {
      const artifact = renderResearchArtifact(type, evidence);
      expect(artifact.citations).toEqual(evidence);
      expect(artifact.content).toContain('[Fonte segura](/transcricoes/t1#l=3)');
      expect(artifact.content).toContain('Um trecho verificável da fonte.');
    });
  }

  test('deduplica fontes indisponíveis sem fabricar citação', () => {
    const artifact = renderResearchArtifact(
      'BRIEFING',
      [],
      [
        { id: 't2', title: 'Fonte indisponível' },
        { id: 't2', title: 'Fonte indisponível' },
      ],
    );
    expect(artifact.citations).toEqual([]);
    expect(artifact.unavailableSources).toEqual([{ id: 't2', title: 'Fonte indisponível' }]);
    expect(artifact.content).toContain('Nenhuma evidência verificável');
  });
});
