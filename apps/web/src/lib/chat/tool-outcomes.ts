/**
 * Server-side helpers for classifying / healing chat tool events.
 * Kept out of client/lib so runtime can import without pulling UI modules oddly —
 * mirrors the client heuristics in chat-tools.ts (keep in sync).
 */

export type ToolState = 'running' | 'completed' | 'error' | 'approval-required';

export type ToolEventLike = {
  id: string;
  name: string;
  state: ToolState;
  input?: unknown;
  output?: unknown;
};

export function isToolErrorOutput(output: unknown): boolean {
  if (!output || typeof output !== 'object') return false;
  const record = output as Record<string, unknown>;
  if (record.outcome === 'error') return true;
  return typeof record.error === 'string' && record.error.trim().length > 0;
}

export function healStaleRunningTools<T extends ToolEventLike>(
  tools: readonly T[],
  message = 'A ferramenta não concluiu a operação.',
): { tools: T[]; changed: boolean } {
  let changed = false;
  const next = tools.map((tool) => {
    if (tool.state !== 'running') return tool;
    changed = true;
    return {
      ...tool,
      state: 'error' as const,
      output:
        tool.output !== undefined && isToolErrorOutput(tool.output)
          ? tool.output
          : { error: message },
    };
  });
  return { tools: next, changed };
}

export function healStaleRunningInSegments<
  TSegment extends { type: 'reasoning' } | { type: 'tool-group'; tools: ToolEventLike[] },
>(
  segments: readonly TSegment[],
  message = 'A ferramenta não concluiu a operação.',
): { segments: TSegment[]; changed: boolean } {
  let changed = false;
  const next = segments.map((segment) => {
    if (segment.type !== 'tool-group') return segment;
    const healed = healStaleRunningTools(segment.tools, message);
    if (!healed.changed) return segment;
    changed = true;
    return { ...segment, tools: healed.tools };
  });
  return { segments: next as TSegment[], changed };
}
