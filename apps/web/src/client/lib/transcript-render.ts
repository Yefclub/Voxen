// Escolha do modo de exibição de uma transcrição.
//
// O `.md` canônico (docs/TRANSCRIPT-FORMAT.md) tem dois formatos de corpo:
//   1. transcrição de mídia — uma linha por segmento, começando por `[HH:MM:SS]`
//      (com ou sem link pro segundo exato);
//   2. prosa markdown — scraping de página, análise visual, análise de documento
//      e análise de post do X, todas geradas por modelo com headings, negrito e
//      listas.
//
// O `TranscriptViewer` só sabe ler o formato (1): ele quebra o corpo em segmentos
// clicáveis e junta tudo num parágrafo. Aplicado ao formato (2), o markdown
// aparece cru (`##`, `**`) e colapsado numa parede de texto. Daí a escolha ser
// feita aqui, pelo conteúdo — não só pela origem.

export type TranscriptRenderMode = 'timeline' | 'markdown';

/** Métodos cujo corpo é sempre prosa markdown, nunca segmentos com timestamp. */
const PROSE_METHODS: ReadonlySet<string> = new Set(['SCRAPE', 'VISION', 'DOCUMENT', 'X_SEARCH']);

/** Linha de segmento: `[MM:SS]` ou `[HH:MM:SS]` no início da linha. */
const TIMESTAMP_LINE = /^\[\d{1,2}:\d{2}(?::\d{2})?\]/mu;

/** Remove o bloco YAML de frontmatter do começo do `.md`. */
export function stripMarkdownFrontmatter(markdown: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(markdown);
  return match ? markdown.slice(match[0].length).trimStart() : markdown;
}

/** True quando o corpo tem ao menos uma linha de segmento com timestamp. */
export function hasTimestampedSegments(markdown: string): boolean {
  return TIMESTAMP_LINE.test(stripMarkdownFrontmatter(markdown));
}

export function transcriptRenderMode({
  source,
  transcriptionMethod,
  markdown,
}: {
  source: string;
  transcriptionMethod: string;
  markdown: string;
}): TranscriptRenderMode {
  if (source === 'WEB') return 'markdown';
  if (PROSE_METHODS.has(transcriptionMethod)) return 'markdown';
  // Cinto e suspensório: método de mídia sem timestamp no corpo (ex.: fallback do
  // backend pro `plainText` quando o `.md` do S3 não abre) também vai pra markdown.
  return hasTimestampedSegments(markdown) ? 'timeline' : 'markdown';
}
