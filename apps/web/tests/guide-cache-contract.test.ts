import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const routeSource = readFileSync(new URL('../src/routes/guide.ts', import.meta.url), 'utf8');
const evidenceSource = readFileSync(
  new URL('../src/client/components/guide/guide-recommendation-evidence.tsx', import.meta.url),
  'utf8',
);

describe('personal Guide cache isolation contract', () => {
  test('prevents a Guide response from surviving an account change in the browser', () => {
    expect(routeSource).toContain("c.header('Cache-Control', 'no-store')");
    expect(routeSource).not.toMatch(/Cache-Control[^\n]*max-age/i);
  });

  test('keeps recommendation diagnostics and source evidence inspectable', () => {
    expect(evidenceSource).toContain('recommendation.personalizedScore');
    expect(evidenceSource).toContain('recommendation.structuralScore');
    expect(evidenceSource).toContain('recommendation.personalizationLift');
    expect(evidenceSource).toContain('reason.community?.cohesion');
    expect(evidenceSource).toContain('reason.evidenceTranscriptIds');
    expect(evidenceSource).toContain('to={`/transcricoes/${source.transcriptId}`}');
  });
});
