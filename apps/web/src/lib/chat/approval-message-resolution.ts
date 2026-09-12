import type { Prisma } from '../../../prisma-generated/client';

type ApprovalResource =
  | { id: string; kind: 'note' }
  | { id: string; kind: 'transcript' }
  | { id: string; kind: 'knowledge'; jobId: string }
  | null;

function toolMatchesApproval(tool: Record<string, unknown>, approvalId: string): boolean {
  if (!tool.output || typeof tool.output !== 'object') return false;
  const output = tool.output as Record<string, unknown>;
  return output.approvalRequired === true && output.approvalId === approvalId;
}

function resolvedOutput(
  previous: Record<string, unknown>,
  resource: ApprovalResource,
): Record<string, unknown> {
  return {
    ...previous,
    approvalRequired: false,
    approved: resource != null,
    ...(resource
      ? resource.kind === 'note'
        ? { noteId: resource.id }
        : resource.kind === 'transcript'
          ? { transcriptId: resource.id }
          : { targetId: resource.id, deletionJobId: resource.jobId }
      : { dismissed: true }),
  };
}

/** Marks matching tools/segments as completed after a HITL decision. */
export function resolveApprovalInMessageJson(
  tools: unknown,
  segments: unknown,
  approvalId: string,
  resource: ApprovalResource,
): { tools: Prisma.InputJsonValue | undefined; segments: Prisma.InputJsonValue | undefined } {
  let toolsChanged = false;
  const nextTools = Array.isArray(tools)
    ? tools.map((raw) => {
        if (!raw || typeof raw !== 'object') return raw;
        const tool = raw as Record<string, unknown>;
        if (!toolMatchesApproval(tool, approvalId)) return raw;
        toolsChanged = true;
        const previous =
          tool.output && typeof tool.output === 'object'
            ? (tool.output as Record<string, unknown>)
            : {};
        return { ...tool, state: 'completed', output: resolvedOutput(previous, resource) };
      })
    : tools;

  let segmentsChanged = false;
  const nextSegments = Array.isArray(segments)
    ? segments.map((raw) => {
        if (!raw || typeof raw !== 'object') return raw;
        const segment = raw as Record<string, unknown>;
        if (segment.type !== 'tool-group' || !Array.isArray(segment.tools)) return raw;
        let groupChanged = false;
        const groupTools = segment.tools.map((toolRaw) => {
          if (!toolRaw || typeof toolRaw !== 'object') return toolRaw;
          const tool = toolRaw as Record<string, unknown>;
          if (!toolMatchesApproval(tool, approvalId)) return toolRaw;
          groupChanged = true;
          const previous =
            tool.output && typeof tool.output === 'object'
              ? (tool.output as Record<string, unknown>)
              : {};
          return { ...tool, state: 'completed', output: resolvedOutput(previous, resource) };
        });
        if (!groupChanged) return raw;
        segmentsChanged = true;
        return { ...segment, tools: groupTools };
      })
    : segments;

  return {
    tools: toolsChanged ? (nextTools as Prisma.InputJsonValue) : undefined,
    segments: segmentsChanged ? (nextSegments as Prisma.InputJsonValue) : undefined,
  };
}
