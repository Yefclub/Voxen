// ============================================================================
// Validated search filters (spec 216 §3) — shared by retrieval + MCP.
// ============================================================================
// Workspace-scoped deterministic search: owner/status isolation is enforced by
// the queries themselves; TRASH is never included. ARCHIVED is included only
// with includeArchived. Ordering is score DESC, document/block identity ASC.
// ============================================================================

export type TranscriptSearchFilters = {
  sources?: readonly string[];
  language?: string;
  publishedAfter?: Date;
  publishedBefore?: Date;
  createdAfter?: Date;
  createdBefore?: Date;
  tags?: readonly string[];
  folderId?: string;
  transcriptIds?: readonly string[];
  includeArchived?: boolean;
};

export type NoteSearchFilters = {
  noteIds?: readonly string[];
  createdAfter?: Date;
  createdBefore?: Date;
};

export type KnowledgeSearchFilters = TranscriptSearchFilters &
  NoteSearchFilters & {
    sourceTypes?: readonly ('transcript' | 'note' | 'external_enrichment')[];
  };

export class SearchFilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SearchFilterError';
  }
}

const TRANSCRIPT_SOURCES = ['YOUTUBE', 'INSTAGRAM', 'TIKTOK', 'X', 'WEB', 'UPLOAD'] as const;
const MAX_FILTER_TAGS = 10;
const MAX_FILTER_IDS = 50;

function assertValidDate(value: unknown, name: string): asserts value is Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new SearchFilterError(`Filtro de data inválido: ${name}.`);
  }
}

export function assertTranscriptSearchFilters(filters: TranscriptSearchFilters): void {
  if (filters.sources !== undefined) {
    if (filters.sources.length === 0 || filters.sources.length > TRANSCRIPT_SOURCES.length) {
      throw new SearchFilterError('Filtro sources inválido: 1-6 valores.');
    }
    for (const source of filters.sources) {
      if (!(TRANSCRIPT_SOURCES as readonly string[]).includes(source)) {
        throw new SearchFilterError(`Fonte desconhecida: ${source}.`);
      }
    }
  }
  if (filters.language !== undefined && !/^[a-z]{2}$/i.test(filters.language)) {
    throw new SearchFilterError('Filtro language inválido: código ISO 639-1 com 2 letras.');
  }
  if (filters.publishedAfter !== undefined)
    assertValidDate(filters.publishedAfter, 'published_after');
  if (filters.publishedBefore !== undefined)
    assertValidDate(filters.publishedBefore, 'published_before');
  if (filters.createdAfter !== undefined) assertValidDate(filters.createdAfter, 'created_after');
  if (filters.createdBefore !== undefined) assertValidDate(filters.createdBefore, 'created_before');
  if (
    filters.publishedAfter !== undefined &&
    filters.publishedBefore !== undefined &&
    filters.publishedAfter >= filters.publishedBefore
  ) {
    throw new SearchFilterError('published_after precisa ser anterior a published_before.');
  }
  if (
    filters.createdAfter !== undefined &&
    filters.createdBefore !== undefined &&
    filters.createdAfter >= filters.createdBefore
  ) {
    throw new SearchFilterError('created_after precisa ser anterior a created_before.');
  }
  if (filters.tags !== undefined) {
    if (filters.tags.length === 0 || filters.tags.length > MAX_FILTER_TAGS) {
      throw new SearchFilterError(`Filtro tags inválido: 1-${MAX_FILTER_TAGS} valores.`);
    }
    for (const tag of filters.tags) {
      if (typeof tag !== 'string' || !tag.trim() || tag.trim().length > 60) {
        throw new SearchFilterError('Filtro tags inválido: nomes com 1-60 chars.');
      }
    }
  }
  if (
    filters.folderId !== undefined &&
    (typeof filters.folderId !== 'string' || !filters.folderId)
  ) {
    throw new SearchFilterError('Filtro folder_id inválido.');
  }
  if (filters.transcriptIds !== undefined) {
    if (filters.transcriptIds.length === 0 || filters.transcriptIds.length > MAX_FILTER_IDS) {
      throw new SearchFilterError(`Filtro transcript_ids inválido: 1-${MAX_FILTER_IDS} valores.`);
    }
    for (const id of filters.transcriptIds) {
      if (typeof id !== 'string' || !id)
        throw new SearchFilterError('Filtro transcript_ids inválido.');
    }
  }
}

export function assertNoteSearchFilters(filters: NoteSearchFilters): void {
  if (filters.noteIds !== undefined) {
    if (filters.noteIds.length === 0 || filters.noteIds.length > MAX_FILTER_IDS) {
      throw new SearchFilterError(`Filtro note_ids inválido: 1-${MAX_FILTER_IDS} valores.`);
    }
    for (const id of filters.noteIds) {
      if (typeof id !== 'string' || !id) throw new SearchFilterError('Filtro note_ids inválido.');
    }
  }
  if (filters.createdAfter !== undefined) assertValidDate(filters.createdAfter, 'created_after');
  if (filters.createdBefore !== undefined) assertValidDate(filters.createdBefore, 'created_before');
  if (
    filters.createdAfter !== undefined &&
    filters.createdBefore !== undefined &&
    filters.createdAfter >= filters.createdBefore
  ) {
    throw new SearchFilterError('created_after precisa ser anterior a created_before.');
  }
}

export function assertKnowledgeSearchFilters(filters: KnowledgeSearchFilters): void {
  assertTranscriptSearchFilters(filters);
  assertNoteSearchFilters(filters);
  if (filters.sourceTypes !== undefined) {
    if (filters.sourceTypes.length === 0 || filters.sourceTypes.length > 3) {
      throw new SearchFilterError('Filtro source_types inválido: 1-3 valores.');
    }
    for (const sourceType of filters.sourceTypes) {
      if (
        sourceType !== 'transcript' &&
        sourceType !== 'note' &&
        sourceType !== 'external_enrichment'
      ) {
        throw new SearchFilterError(`Tipo de fonte desconhecido: ${sourceType}.`);
      }
    }
  }
}
