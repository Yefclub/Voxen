import { describe, expect, test } from 'bun:test';
import {
  hasTimestampedSegments,
  stripMarkdownFrontmatter,
  transcriptRenderMode,
} from '../src/client/lib/transcript-render';

const FRONTMATTER = ['---', 'id: abc', 'title: Exemplo', 'source: x', '---', ''].join('\n');

function withFrontmatter(body: string): string {
  return `${FRONTMATTER}\n${body}`;
}

describe('stripMarkdownFrontmatter', () => {
  test('remove o bloco YAML inicial', () => {
    expect(stripMarkdownFrontmatter(withFrontmatter('# Título\n\ncorpo'))).toBe(
      '# Título\n\ncorpo',
    );
  });

  test('mantém o conteúdo quando não há frontmatter', () => {
    expect(stripMarkdownFrontmatter('# Título\n\ncorpo')).toBe('# Título\n\ncorpo');
  });

  test('não corta o corpo quando o markdown começa com regra horizontal', () => {
    expect(stripMarkdownFrontmatter('---\n')).toBe('---\n');
  });
});

describe('hasTimestampedSegments', () => {
  test('detecta linhas no formato canônico [HH:MM:SS](link)', () => {
    const md = withFrontmatter('## Transcrição\n\n[00:00:12](https://youtu.be/x?t=12) Olá\n');
    expect(hasTimestampedSegments(md)).toBe(true);
  });

  test('detecta timestamps curtos [MM:SS] sem link', () => {
    expect(hasTimestampedSegments('[01:20] trecho de fala')).toBe(true);
  });

  test('é falso para markdown de prosa (headings, negrito, listas)', () => {
    const md = withFrontmatter(
      '# Análise do Post\n\n**URL:** https://x.com/i/status/1\n\n## 1. Resumo\n\n- item\n',
    );
    expect(hasTimestampedSegments(md)).toBe(false);
  });

  test('não confunde link markdown no meio da linha com timestamp', () => {
    expect(hasTimestampedSegments('veja [00:10](https://exemplo.com) no meio')).toBe(false);
  });
});

describe('transcriptRenderMode', () => {
  const timeline = '## Transcrição\n\n[00:00:00](https://youtu.be/x?t=0) fala\n';
  const prose = '# Análise\n\n**Ponto:** relevante\n\n## Seção\n\n- item\n';

  test('vídeo transcrito com timestamps usa a leitura por segmentos', () => {
    expect(
      transcriptRenderMode({
        source: 'YOUTUBE',
        transcriptionMethod: 'SUBTITLES',
        markdown: withFrontmatter(timeline),
      }),
    ).toBe('timeline');
  });

  test('post do X analisado por IA renderiza markdown', () => {
    expect(
      transcriptRenderMode({
        source: 'X',
        transcriptionMethod: 'X_SEARCH',
        markdown: withFrontmatter(prose),
      }),
    ).toBe('markdown');
  });

  test('página web, análise visual e documento continuam em markdown', () => {
    for (const [source, method] of [
      ['WEB', 'SCRAPE'],
      ['UPLOAD', 'VISION'],
      ['UPLOAD', 'DOCUMENT'],
    ] as const) {
      expect(
        transcriptRenderMode({
          source,
          transcriptionMethod: method,
          markdown: withFrontmatter(prose),
        }),
      ).toBe('markdown');
    }
  });

  test('método de prosa vence mesmo quando o corpo tem linha com timestamp', () => {
    // Achado por mutação no review da PR #501: sem este caso, remover
    // X_SEARCH/VISION/DOCUMENT de PROSE_METHODS deixava a suíte inteira
    // verde — os testes acima usam prosa SEM timestamp, então caem no
    // fallback por conteúdo e passariam mesmo sem o set existir.
    //
    // O set é load-bearing justamente aqui: uma análise de visão/documento/X
    // pode conter uma linha começando com [00:12] (screenshot de player,
    // log, grade de horários) sem ser transcrição por segmentos.
    const proseComTimestamp = [
      '## Análise',
      '',
      '[00:12] aparece no player do vídeo mostrado no print',
      '',
      'Resto da análise em prosa.',
    ].join('\n');
    expect(hasTimestampedSegments(withFrontmatter(proseComTimestamp))).toBe(true);

    for (const [source, method] of [
      ['X', 'X_SEARCH'],
      ['UPLOAD', 'VISION'],
      ['UPLOAD', 'DOCUMENT'],
      // UPLOAD/SCRAPE, não WEB/SCRAPE: o short-circuit de `source === 'WEB'`
      // resolve antes do set ser consultado, então a tupla com WEB não
      // exercitaria PROSE_METHODS (achado do review).
      ['UPLOAD', 'SCRAPE'],
    ] as const) {
      expect(
        transcriptRenderMode({
          source,
          transcriptionMethod: method,
          markdown: withFrontmatter(proseComTimestamp),
        }),
      ).toBe('markdown');
    }
  });

  test('conteúdo sem timestamp nunca cai na leitura por segmentos', () => {
    // Fallback do backend quando o .md do S3 não pode ser lido: `# título` + plainText.
    expect(
      transcriptRenderMode({
        source: 'TIKTOK',
        transcriptionMethod: 'API',
        markdown: '# Vídeo\n\ntexto puro sem timestamps',
      }),
    ).toBe('markdown');
  });

  test('markdown vazio não quebra a escolha', () => {
    expect(
      transcriptRenderMode({ source: 'YOUTUBE', transcriptionMethod: 'API', markdown: '' }),
    ).toBe('markdown');
  });
});
