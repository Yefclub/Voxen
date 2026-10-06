import type { McpScope } from '../lib/mcp-tokens';

// The single source of truth for permission checks and tool registration policy.
export const MCP_TOOL_SCOPES = {
  voxen_brain_compilation_status: 'READ',
  voxen_brain_hubs: 'READ',
  voxen_brain_neighbors: 'READ',
  voxen_brain_path: 'READ',
  voxen_brain_search: 'READ',
  voxen_brain_sources: 'READ',
  voxen_brain_timeline: 'READ',
  voxen_expand_context: 'READ',
  voxen_get_job_status: 'READ',
  voxen_list_note_revisions: 'READ',
  voxen_list_notes: 'READ',
  voxen_list_transcript_corrections: 'READ',
  voxen_list_transcript_enrichments: 'READ',
  voxen_list_transcripts: 'READ',
  voxen_outline: 'READ',
  voxen_personal_context: 'READ',
  voxen_read_lines: 'READ',
  voxen_read_note: 'READ',
  voxen_read_note_revision: 'READ',
  voxen_read_section: 'READ',
  voxen_read_timespan: 'READ',
  voxen_read_transcript: 'READ',
  voxen_read_transcript_correction: 'READ',
  voxen_read_transcript_enrichment: 'READ',
  voxen_related: 'READ',
  voxen_search_knowledge: 'READ',
  voxen_search_note_content: 'READ',
  voxen_search_notes: 'READ',
  voxen_search_transcript_content: 'READ',
  voxen_search_transcripts: 'READ',
  voxen_verify_citations: 'READ',
  voxen_create_note: 'WRITE',
  voxen_update_note: 'WRITE',
  voxen_patch_note: 'WRITE',
  voxen_restore_note_revision: 'WRITE',
  voxen_patch_transcript: 'WRITE',
  voxen_restore_transcript_correction: 'WRITE',
  voxen_request_transcription: 'WRITE',
  voxen_request_transcriptions: 'WRITE',
  voxen_request_transcript_research: 'WRITE',
  voxen_review_transcript_enrichment: 'WRITE',
  voxen_edit_transcript_enrichment: 'WRITE',
  voxen_delete_transcript_enrichment: 'WRITE',
  voxen_delete_knowledge: 'WRITE',
} as const satisfies Record<string, McpScope>;

type WriteEffects = { destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
const WRITE_EFFECTS = {
  voxen_create_note: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
  voxen_update_note: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
  voxen_patch_note: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
  voxen_restore_note_revision: {
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  voxen_patch_transcript: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
  voxen_restore_transcript_correction: {
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  voxen_request_transcription: {
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  voxen_request_transcriptions: {
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  voxen_request_transcript_research: {
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  voxen_review_transcript_enrichment: {
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  voxen_edit_transcript_enrichment: {
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  voxen_delete_transcript_enrichment: {
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  voxen_delete_knowledge: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
} satisfies Record<string, WriteEffects>;

export function mcpToolAnnotations(name: keyof typeof MCP_TOOL_SCOPES) {
  if (MCP_TOOL_SCOPES[name] === 'READ')
    return {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    };
  const effects = WRITE_EFFECTS[name as keyof typeof WRITE_EFFECTS];
  if (!effects) throw new Error('MCP write effect policy is missing');
  return { readOnlyHint: false, ...effects };
}

export function requiredMcpToolScope(payload: unknown): McpScope | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const request = payload as { method?: unknown; params?: { name?: unknown } };
  if (request.method !== 'tools/call' || typeof request.params?.name !== 'string') return null;
  return Object.hasOwn(MCP_TOOL_SCOPES, request.params.name)
    ? MCP_TOOL_SCOPES[request.params.name as keyof typeof MCP_TOOL_SCOPES]
    : null;
}
