export type UrlIntent =
  | { kind: 'none'; urls: [] }
  | { kind: 'explicit-ingest'; urls: string[] }
  | { kind: 'ambiguous'; urls: string[] };

const URL_PATTERN = /https?:\/\/[^\s<>"'`]*/giu;
const EXPLICIT_INGEST_PATTERN =
  /\b(transcrev(?:a|e|er|endo)?|resum(?:a|e|ir|indo)?|analis(?:a|e|ar|ando)?|extra(?:ia|ir|indo)?|leia|ler|salv(?:a|e|ar|ando)?|organiz(?:a|e|ar|ando)?|traduz(?:a|ir|indo)?|ingest(?:a|e|ir|indo)?)\b/iu;

function normalizeUrl(value: string): string | null {
  const trimmed = value.replace(/[),.;!?]+$/u, '');
  try {
    return new URL(trimmed).toString();
  } catch {
    return null;
  }
}

/**
 * Classifies only the current message. A bare link is intentionally ambiguous:
 * receiving it must not silently turn into either web research or ingestion.
 */
export function classifyUrlIntent(content: string): UrlIntent {
  const candidates = [...content.matchAll(URL_PATTERN)].map((match) => match[0]);
  const urls = [
    ...new Set(candidates.map((candidate) => normalizeUrl(candidate)).filter(Boolean)),
  ] as string[];
  if (candidates.length === 0) return { kind: 'none', urls: [] };
  // Um endereço malformado também não pode liberar uma pesquisa alternativa:
  // o chat pede correção do link, em vez de tentar adivinhar o conteúdo.
  if (urls.length !== candidates.length) return { kind: 'ambiguous', urls };
  return EXPLICIT_INGEST_PATTERN.test(content)
    ? { kind: 'explicit-ingest', urls }
    : { kind: 'ambiguous', urls };
}

export function isSharedUrl(intent: UrlIntent, value: string): boolean {
  if (intent.kind === 'none') return false;
  const normalized = normalizeUrl(value);
  return intent.urls.length === 1 && normalized === intent.urls[0];
}

/**
 * Requires tool arguments to preserve the complete URL list from the current
 * user turn. This prevents a model-generated duplicate from silently replacing
 * another URL and keeps result indexes aligned with the input.
 */
export function matchesUrlList(intent: UrlIntent, values: string[]): boolean {
  if (intent.kind === 'none' || values.length !== intent.urls.length) return false;
  return values.every((value, index) => normalizeUrl(value) === intent.urls[index]);
}

export function buildUrlIntentInstructions(intent: UrlIntent): string {
  if (intent.kind === 'explicit-ingest') {
    const tool = intent.urls.length > 1 ? 'request_transcriptions' : 'request_transcription';
    return [
      '',
      'POLÍTICA DE URL DESTE TURNO: o usuário compartilhou URL(s) com intenção explícita de conteúdo.',
      `Use ${tool} exatamente para todas as URLs compartilhadas antes de responder. Não use web_search`,
      'nem search_x como substituto para esse conteúdo.',
    ].join('\n');
  }
  if (intent.kind === 'ambiguous') {
    return [
      '',
      'POLÍTICA DE URL DESTE TURNO: o usuário enviou uma URL sem ação explícita.',
      'Não use web_search, search_x, request_transcription nem request_transcriptions. Pergunte, em uma única frase, o que ele',
      'quer fazer com o link: transcrever, resumir, analisar ou salvar.',
    ].join('\n');
  }
  return '';
}
