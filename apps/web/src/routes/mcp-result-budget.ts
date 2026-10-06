import type { McpScope } from '../lib/mcp-tokens';
import { ok } from './mcp-tool-helpers';
import {
  contentCursor,
  contentOffset,
  resultDigest,
  McpResultBudgetError,
  type McpResultContext,
} from './mcp-content-cursor';
export { McpResultBudgetError } from './mcp-content-cursor';
export const MCP_RESULT_WIRE_BYTES = 96 * 1024;
const MAX_READ_RESULT_BYTES = 16 * 1024 * 1024;
const RESULT_BUDGET = MCP_RESULT_WIRE_BYTES - 4096;
const wireSize = (data: Record<string, unknown>) => Buffer.byteLength(JSON.stringify(ok(data)));

function writeSummary(data: Record<string, unknown>): Record<string, unknown> {
  const allowed = new Set([
    'id',
    'noteId',
    'baseRevision',
    'jobId',
    'transcriptId',
    'targetId',
    'targetType',
    'revision',
    'checksum',
    'sourceVersion',
    'sourceChecksum',
    'status',
    'outcome',
    'applied',
    'graphSync',
    'reviewState',
    'restoredFromRevision',
    'index',
    'created',
    'total',
    'queued',
    'reused',
  ]);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (
      allowed.has(key) &&
      (value === null ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        (typeof value === 'string' && value.length <= 256))
    )
      result[key] = value;
    if (['correction', 'items'].includes(key)) {
      if (Array.isArray(value))
        result[key] = value
          .slice(0, 20)
          .filter((v) => v && typeof v === 'object')
          .map((v) => writeSummary(v));
      else if (value && typeof value === 'object')
        result[key] = writeSummary(value as Record<string, unknown>);
    }
  }
  return result;
}
function writeFollowUp(tool: string, summary: Record<string, unknown>): Record<string, unknown> {
  if (summary.jobId) return { tool: 'voxen_get_job_status', arguments: { job_id: summary.jobId } };
  if (Array.isArray(summary.items))
    return {
      tool: 'voxen_get_job_status',
      jobs: summary.items
        .filter(
          (item) => item && typeof item === 'object' && (item as Record<string, unknown>).jobId,
        )
        .map((item) => ({ arguments: { job_id: (item as Record<string, unknown>).jobId } })),
      instruction: 'Monitor each returned job independently.',
    };
  const correction = summary.correction as Record<string, unknown> | undefined;
  if (correction?.transcriptId)
    return {
      tool: 'voxen_read_transcript_correction',
      arguments: { transcript_id: correction.transcriptId, revision: correction.revision },
    };
  if (tool.includes('enrichment'))
    return { tool: 'voxen_read_transcript_enrichment', arguments: { enrichment_id: summary.id } };
  if (tool.includes('note'))
    return { tool: 'voxen_read_note', arguments: { note_id: summary.noteId ?? summary.id } };
  if (summary.transcriptId)
    return { tool: 'voxen_read_transcript', arguments: { transcript_id: summary.transcriptId } };
  return {
    tool: 'voxen_get_job_status',
    instruction: 'For batch results, monitor each returned jobId independently.',
  };
}
/** Returns an ordinary result or an explicit bounded alternative; never a silent partial object. */
export function budgetMcpResult(
  data: Record<string, unknown>,
  context: McpResultContext,
  scope: McpScope,
  now = Date.now(),
): Record<string, unknown> {
  if (scope === 'WRITE' && context.cursor)
    throw new McpResultBudgetError('MCP_INVALID_CONTENT_CURSOR');
  const serialized = JSON.stringify(data);
  if (scope === 'READ' && Buffer.byteLength(serialized) > MAX_READ_RESULT_BYTES)
    throw new McpResultBudgetError('MCP_RESULT_TOO_LARGE');
  const digest = resultDigest(serialized);
  const offset = contentOffset(context, digest, serialized.length, now);
  if (offset === 0 && wireSize(data) <= RESULT_BUDGET) return data;
  if (scope === 'WRITE') {
    const summary = writeSummary(data);
    const result = {
      summary,
      _mcp: {
        truncated: true,
        toolExecution: 'completed',
        nextCursor: null,
        followUp: writeFollowUp(context.tool, summary),
        instruction:
          'The tool completed. This reply omits large content fields. If applied=false, no write was applied; reread before preparing a new preview. Otherwise verify the returned identifiers with the follow-up READ tool; do not repeat an uncertain write.',
      },
    };
    if (wireSize(result) > RESULT_BUDGET) throw new McpResultBudgetError('MCP_RESULT_TOO_LARGE');
    return result;
  }
  if (Buffer.byteLength(serialized) > MAX_READ_RESULT_BYTES)
    throw new McpResultBudgetError('MCP_RESULT_TOO_LARGE');
  let end = Math.min(serialized.length, offset + 24 * 1024);
  while (true) {
    if (
      end < serialized.length &&
      serialized.charCodeAt(end - 1) >= 0xd800 &&
      serialized.charCodeAt(end - 1) <= 0xdbff &&
      serialized.charCodeAt(end) >= 0xdc00 &&
      serialized.charCodeAt(end) <= 0xdfff
    )
      end--;
    const result = {
      dataChunk: serialized.slice(offset, end),
      _mcp: {
        truncated: true,
        format: 'application/json',
        offset,
        offsetUnit: 'utf16',
        totalChars: serialized.length,
        resultChecksum: digest,
        nextCursor: end < serialized.length ? contentCursor(end, digest, context, now) : null,
        instruction:
          'This is a JSON text fragment, not a complete result. Continue the same READ tool with the original arguments and content_cursor=nextCursor. Concatenate dataChunk values in order and parse JSON only after nextCursor is null. If content changes, restart the read.',
      },
    };
    if (wireSize(result) <= RESULT_BUDGET) return result;
    if (end - offset < 2) throw new McpResultBudgetError('MCP_RESULT_TOO_LARGE');
    end = offset + Math.floor((end - offset) / 2);
  }
}
