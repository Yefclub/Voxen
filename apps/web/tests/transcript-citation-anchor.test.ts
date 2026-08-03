import { describe, expect, it } from 'bun:test';
import { resolveTranscriptCitationAnchor } from '../src/client/lib/transcript-citation-anchor';

const segments = [
  { startSec: 0, line: 8 },
  { startSec: 42, line: 19 },
  { startSec: 95, line: 31 },
];

describe('resolveTranscriptCitationAnchor', () => {
  it('abre a seção que contém o timestamp mesmo quando ele não coincide com o início', () => {
    expect(resolveTranscriptCitationAnchor(segments, '#t=59')).toBe(19);
  });

  it('abre o segmento que contém a linha citada', () => {
    expect(resolveTranscriptCitationAnchor(segments, '#l=23')).toBe(19);
  });

  it('ignora hash que não é uma citação', () => {
    expect(resolveTranscriptCitationAnchor(segments, '#anything')).toBeNull();
  });
});
