import { describe, expect, it } from 'bun:test';
import {
  MAX_READ_LINES,
  expandContextFromMd,
  normalizeForMatch,
  parseLineTimestamp,
  parseOutline,
  promptSearchQuery,
  readLinesFromMd,
  readSectionFromMd,
  readTimespanFromMd,
  secondsToHms,
  verifyClaimAgainstMd,
} from '../src/lib/retrieval';

describe('promptSearchQuery', () => {
  it('transforma prompt livre em uma consulta OR curta sem URLs ou stop words', () => {
    expect(promptSearchQuery('Pesquise sobre política monetária e juros em https://x.com/a')).toBe(
      'pesquise OR politica OR monetaria OR juros',
    );
  });

  it('limita e deduplica termos para não despejar o prompt no FTS', () => {
    expect(promptSearchQuery('alpha alpha beta gamma delta epsilon zeta eta theta iota')).toBe(
      'alpha OR beta OR gamma OR delta OR epsilon OR zeta OR eta OR theta',
    );
  });
});

// `.md` de exemplo no formato canônico (docs/TRANSCRIPT-FORMAT.md): frontmatter,
// headings e linhas timestamped `[hh:mm:ss](url?t=SEG) texto`.
const SAMPLE_MD = `---
id: abc123
source: youtube
title: Postgres FTS na prática
---

![thumb](https://img/x.jpg)

# Postgres FTS na prática

> 🎬 [Vídeo original](https://youtu.be/x) — Canal — 5m

## Introdução

[00:00:00](https://youtu.be/x?t=0) Olá pessoal, hoje vamos falar sobre Postgres Full Text Search.

[00:00:15](https://youtu.be/x?t=15) Antes de tudo, é importante entender por que FTS é diferente de um ILIKE.

## Demonstração

[00:01:00](https://youtu.be/x?t=60) Vou abrir o psql e mostrar a diferença na prática.

[00:02:30](https://youtu.be/x?t=150) Repare no uso do ts_rank para ordenar por relevância.
`;

describe('parseLineTimestamp', () => {
  it('extrai segundos de uma linha timestamped', () => {
    expect(parseLineTimestamp('[00:00:15](https://youtu.be/x?t=15) texto')).toBe(15);
    expect(parseLineTimestamp('[01:02:03](url) texto')).toBe(3723);
  });

  it('retorna null para linhas sem timestamp', () => {
    expect(parseLineTimestamp('## Introdução')).toBeNull();
    expect(parseLineTimestamp('texto qualquer')).toBeNull();
    expect(parseLineTimestamp('')).toBeNull();
  });
});

describe('secondsToHms', () => {
  it('formata com zero-padding', () => {
    expect(secondsToHms(0)).toBe('00:00:00');
    expect(secondsToHms(15)).toBe('00:00:15');
    expect(secondsToHms(3723)).toBe('01:02:03');
  });
});

describe('normalizeForMatch', () => {
  it('remove acentos, minúsculas e colapsa não-alfanuméricos', () => {
    expect(normalizeForMatch('Olá,   PESSOAL!')).toBe('ola pessoal');
    expect(normalizeForMatch('[00:00:15](url) É importante')).toBe('00 00 15 url e importante');
  });
});

describe('parseOutline', () => {
  it('extrai seções com heading, linha inicial e primeiro timestamp', () => {
    const outline = parseOutline(SAMPLE_MD);
    expect(outline.totalLines).toBeGreaterThan(0);
    const headings = outline.sections.map((s) => s.heading);
    expect(headings).toContain('Postgres FTS na prática');
    expect(headings).toContain('Introdução');
    expect(headings).toContain('Demonstração');

    const intro = outline.sections.find((s) => s.heading === 'Introdução')!;
    expect(intro.startSec).toBe(0);
    expect(intro.startTs).toBe('00:00:00');

    const demo = outline.sections.find((s) => s.heading === 'Demonstração')!;
    expect(demo.startSec).toBe(60);
    expect(demo.startTs).toBe('00:01:00');
    expect(demo.lineCount).toBeGreaterThan(0);
  });

  it('sem headings devolve seções vazias mas conta linhas', () => {
    const outline = parseOutline('linha 1\nlinha 2\nlinha 3');
    expect(outline.sections).toHaveLength(0);
    expect(outline.totalLines).toBe(3);
  });
});

describe('readLinesFromMd', () => {
  it('lê intervalo inclusivo 1-indexed', () => {
    const md = 'a\nb\nc\nd\ne';
    const r = readLinesFromMd(md, 2, 4);
    expect(r.lines).toEqual([
      { n: 2, text: 'b' },
      { n: 3, text: 'c' },
      { n: 4, text: 'd' },
    ]);
    expect(r.totalLines).toBe(5);
    expect(r.truncated).toBe(false);
  });

  it('faz clamp de bounds fora do range', () => {
    const md = 'a\nb\nc';
    const r = readLinesFromMd(md, 0, 999);
    expect(r.from).toBe(1);
    expect(r.to).toBe(3);
    expect(r.lines).toHaveLength(3);
  });

  it('aplica o cap de MAX_READ_LINES e marca truncated', () => {
    const md = Array.from({ length: 500 }, (_, i) => `linha ${i + 1}`).join('\n');
    const r = readLinesFromMd(md, 1, 500);
    expect(r.lines).toHaveLength(MAX_READ_LINES);
    expect(r.truncated).toBe(true);
    expect(r.to).toBe(MAX_READ_LINES);
  });
});

describe('readSectionFromMd', () => {
  it('lê seção por heading (match parcial, case-insensitive)', () => {
    const r = readSectionFromMd(SAMPLE_MD, { heading: 'demonstra' });
    expect(r).not.toBeNull();
    expect(r!.section.heading).toBe('Demonstração');
    const joined = r!.lines.map((l) => l.text).join('\n');
    expect(joined).toContain('ts_rank');
    expect(joined).not.toContain('Full Text Search');
  });

  it('lê seção por índice', () => {
    const r = readSectionFromMd(SAMPLE_MD, { index: 1 });
    expect(r).not.toBeNull();
    expect(r!.section.heading).toBe('Introdução');
  });

  it('retorna null quando a seção não existe', () => {
    expect(readSectionFromMd(SAMPLE_MD, { heading: 'inexistente' })).toBeNull();
    expect(readSectionFromMd(SAMPLE_MD, { index: 99 })).toBeNull();
  });
});

describe('readTimespanFromMd', () => {
  it('retorna só as linhas dentro do intervalo de tempo', () => {
    const r = readTimespanFromMd(SAMPLE_MD, 10, 70);
    const secs = r.lines.map((l) => parseLineTimestamp(l.text));
    expect(secs).toEqual([15, 60]);
  });

  it('normaliza intervalo invertido e ignora linhas sem timestamp', () => {
    const r = readTimespanFromMd(SAMPLE_MD, 70, 10);
    expect(r.fromSec).toBe(10);
    expect(r.toSec).toBe(70);
    expect(r.lines.every((l) => parseLineTimestamp(l.text) !== null)).toBe(true);
  });
});

describe('expandContextFromMd', () => {
  it('expande janela ao redor de uma linha-âncora', () => {
    const md = Array.from({ length: 20 }, (_, i) => `linha ${i + 1}`).join('\n');
    const r = expandContextFromMd(md, { line: 10 }, 2);
    expect(r).not.toBeNull();
    expect(r!.anchorLine).toBe(10);
    expect(r!.from).toBe(8);
    expect(r!.to).toBe(12);
    expect(r!.lines).toHaveLength(5);
  });

  it('ancora por timestamp na linha que cobre o instante', () => {
    // sec=90 fica entre 00:01:00 (60) e 00:02:30 (150) -> ancora na linha de t=60.
    const r = expandContextFromMd(SAMPLE_MD, { sec: 90 }, 0);
    expect(r).not.toBeNull();
    expect(parseLineTimestamp(r!.lines[0]?.text)).toBe(60);
  });
});

describe('verifyClaimAgainstMd', () => {
  it('confirma citação presente no intervalo de linhas', () => {
    const outline = parseOutline(SAMPLE_MD);
    // Localiza a linha do texto de introdução.
    const lines = SAMPLE_MD.split('\n');
    const lineNo = lines.findIndex((l) => l.includes('Full Text Search')) + 1;
    const verdict = verifyClaimAgainstMd(SAMPLE_MD, {
      quote: 'hoje vamos falar sobre Postgres Full Text Search',
      fromLine: lineNo,
      toLine: lineNo,
    });
    expect(verdict.supported).toBe(true);
    expect(verdict.region).toEqual({ from: lineNo, to: lineNo });
    expect(outline.totalLines).toBeGreaterThan(lineNo);
  });

  it('não confirma citação ausente no intervalo indicado', () => {
    const verdict = verifyClaimAgainstMd(SAMPLE_MD, {
      quote: 'isso nunca foi dito no vídeo',
      fromLine: 1,
      toLine: 5,
    });
    expect(verdict.supported).toBe(false);
  });

  it('confirma por intervalo de tempo com normalização de acentos', () => {
    const verdict = verifyClaimAgainstMd(SAMPLE_MD, {
      quote: 'e importante entender por que fts e diferente de um ilike',
      fromSec: 10,
      toSec: 20,
    });
    expect(verdict.supported).toBe(true);
  });

  it('busca no documento inteiro quando não há bounds', () => {
    const verdict = verifyClaimAgainstMd(SAMPLE_MD, { quote: 'ts_rank para ordenar' });
    expect(verdict.supported).toBe(true);
    expect(verdict.region).toBeNull();
  });

  it('quote vazia após normalização não é suportada', () => {
    const verdict = verifyClaimAgainstMd(SAMPLE_MD, { quote: '   !!!   ' });
    expect(verdict.supported).toBe(false);
  });
});
