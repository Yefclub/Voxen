// ============================================================================
// Helpers puros da UI de ferramentas do chat (spec 076)
// ----------------------------------------------------------------------------
// Mapeiam eventos de ferramenta (nome/estado) para a linguagem visual do
// toolblock: família → ícone/rótulo, resumo de famílias, estado agregado e
// formatação de duração. Puros e testáveis (sem DOM/React).
// ============================================================================

export type ToolState = 'running' | 'completed' | 'error' | 'approval-required';

export interface ToolLike {
  name: string;
  state: ToolState;
}

/** Categorias visuais de ferramenta — definem ícone e agrupamento no resumo. */
export type ToolFamily = 'search' | 'read' | 'notes' | 'brain' | 'web' | 'transcript' | 'other';

const FAMILY_BY_NAME: Record<string, ToolFamily> = {
  // busca
  search_transcripts: 'search',
  search_notes: 'search',
  list_transcripts: 'search',
  list_notes: 'search',
  // leitura / recuperação progressiva
  outline_transcript: 'read',
  read_lines: 'read',
  read_section: 'read',
  read_timespan: 'read',
  expand_context: 'read',
  read_transcript: 'read',
  read_transcript_section: 'read',
  read_transcript_summary: 'read',
  read_note: 'read',
  get_metadata: 'read',
  verify_citations: 'read',
  // notas (efeito colateral proposto)
  propose_create_note: 'notes',
  create_note: 'notes',
  edit_note: 'notes',
  delete_note: 'notes',
  // brain / grafo
  related: 'brain',
  brain_search: 'brain',
  brain_neighbors: 'brain',
  brain_sources: 'brain',
  brain_path: 'brain',
  // web
  web_search: 'web',
  search_x: 'web',
  scrape_url: 'web',
  // transcrição
  transcribe_video: 'transcript',
  request_transcription: 'transcript',
  get_job_status: 'transcript',
};

/** Nomes com rótulo dedicado em i18n (`tools.<name>`). */
export const KNOWN_TOOL_NAMES: readonly string[] = Object.keys(FAMILY_BY_NAME);

/** Família visual de uma ferramenta pelo nome (fallback `other`). */
export function toolFamily(name: string): ToolFamily {
  return FAMILY_BY_NAME[name] ?? 'other';
}

/** Rótulo humano de fallback quando não há chave i18n dedicada. */
export function prettifyToolName(name: string): string {
  const spaced = name.replaceAll('_', ' ').trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : name;
}

/** `true` se há rótulo i18n `tools.<name>` para esta ferramenta. */
export function hasToolLabel(name: string): boolean {
  return KNOWN_TOOL_NAMES.includes(name);
}

/**
 * Estado agregado do toolblock (spec 090):
 * - `running` só enquanto a ferramenta está de fato em execução;
 * - aprovação pendente NÃO conta como running (HITL vive fora do “Pensando”);
 * - senão `error` se alguma falhou;
 * - senão `done`.
 */
export function toolBlockState(tools: readonly ToolLike[]): 'running' | 'error' | 'done' {
  let hasError = false;
  for (const tool of tools) {
    if (tool.state === 'running') return 'running';
    if (tool.state === 'error') hasError = true;
  }
  return hasError ? 'error' : 'done';
}

export {
  healStaleRunningTools,
  isToolErrorOutput,
  type ToolEventLike as HealableTool,
} from '../../lib/chat/tool-outcomes';

export type PendingHitl = {
  approvalId: string;
  toolName: string;
  title: string | null;
  action: string | null;
};

/** Extrai aprovações HITL ainda pendentes a partir do output de ferramentas. */
export function pendingHitlFromTools(
  tools: readonly { name: string; state: ToolState; output?: unknown }[] | null | undefined,
): PendingHitl[] {
  if (!tools?.length) return [];
  const pending: PendingHitl[] = [];
  for (const tool of tools) {
    if (tool.state !== 'approval-required' || !tool.output || typeof tool.output !== 'object')
      continue;
    const output = tool.output as Record<string, unknown>;
    if (output.approvalRequired !== true || typeof output.approvalId !== 'string') continue;
    pending.push({
      approvalId: output.approvalId,
      toolName: tool.name,
      title: typeof output.title === 'string' ? output.title : null,
      action: typeof output.action === 'string' ? output.action : null,
    });
  }
  return pending;
}

/**
 * Formata uma duração em ms para rótulo compacto ("0,4s", "3s", "1m 05s").
 * PT-BR usa vírgula decimal; abaixo de 10s mostra 1 casa, senão inteiro.
 */
export function formatToolDuration(ms: number): string {
  const totalSeconds = Math.max(0, ms) / 1000;
  if (totalSeconds < 10) {
    return `${totalSeconds.toFixed(1).replace('.', ',')}s`;
  }
  // Arredonda pra segundo inteiro ANTES de decidir minuto/segundo — evita tanto
  // "60s" (59,6s) quanto "1m 60s" (119,6s) por arredondamento na borda.
  const rounded = Math.round(totalSeconds);
  if (rounded >= 60) {
    const minutes = Math.floor(rounded / 60);
    const seconds = rounded % 60;
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  }
  return `${rounded}s`;
}

// ----------------------------------------------------------------------------
// Detecção de kind do anexo no cliente (espelha apps/web/src/lib/media-upload.ts)
// ----------------------------------------------------------------------------

export type AttachmentKind = 'image' | 'media' | 'document';

const IMAGE_EXTENSIONS = new Set(['gif', 'jpeg', 'jpg', 'png', 'webp']);

const MEDIA_EXTENSIONS = new Set([
  'aac',
  'aiff',
  'avi',
  'flac',
  'm4a',
  'm4v',
  'mkv',
  'mov',
  'mp3',
  'mp4',
  'mpeg',
  'mpga',
  'ogg',
  'opus',
  'wav',
  'webm',
  'wma',
]);

const DOCUMENT_EXTENSIONS = new Set([
  'csv',
  'docx',
  'epub',
  'htm',
  'html',
  'json',
  'md',
  'pdf',
  'pptx',
  'txt',
  'xls',
  'xlsx',
  'xml',
]);

function extensionOf(filename: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(filename);
  return match?.[1]?.toLowerCase() ?? '';
}

/**
 * Detecta o kind de um anexo a partir do nome + MIME, na mesma ordem do backend
 * (imagem → mídia → documento). Retorna `null` se o tipo não é suportado.
 */
export function attachmentKind(filename: string, contentType: string): AttachmentKind | null {
  const type = (contentType || '').toLowerCase().split(';', 1)[0]?.trim() ?? '';
  const ext = extensionOf(filename);

  if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(type)) return 'image';
  if (type.startsWith('audio/') || type.startsWith('video/')) return 'media';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (MEDIA_EXTENSIONS.has(ext)) return 'media';
  if (DOCUMENT_EXTENSIONS.has(ext)) return 'document';

  const DOCUMENT_MIME = new Set([
    'application/csv',
    'application/epub+zip',
    'application/json',
    'application/pdf',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/xml',
    'text/csv',
    'text/html',
    'text/markdown',
    'text/plain',
    'text/xml',
  ]);
  if (DOCUMENT_MIME.has(type)) return 'document';
  return null;
}

/** Atributo `accept` do input de upload (imagem + mídia + documentos). */
export const CHAT_UPLOAD_ACCEPT = [
  'image/*',
  'audio/*',
  'video/*',
  ...[...IMAGE_EXTENSIONS, ...MEDIA_EXTENSIONS, ...DOCUMENT_EXTENSIONS].map((ext) => `.${ext}`),
].join(',');
