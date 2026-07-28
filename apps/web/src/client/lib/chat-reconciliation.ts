export type ActiveTurnIdentity = {
  id: string;
  status: string;
  assistantMessageId: string;
  updatedAt?: string;
};

export type ChatStartIdentity = {
  userMessageId: string;
  assistantMessageId: string;
  startedAt: string;
};

export function sameActiveTurn(
  left: ActiveTurnIdentity | null,
  right: ActiveTurnIdentity | null,
): boolean {
  return (
    left === right ||
    (left != null &&
      right != null &&
      left.id === right.id &&
      left.status === right.status &&
      left.assistantMessageId === right.assistantMessageId)
  );
}

export function reconcileChatStart<T extends { id: string; createdAt: string }>(
  current: readonly T[],
  previousUserMessageId: string,
  previousAssistantMessageId: string,
  start: ChatStartIdentity,
): T[] {
  let changed = false;
  const reconciled = current.map((message) => {
    const nextId =
      message.id === previousUserMessageId
        ? start.userMessageId
        : message.id === previousAssistantMessageId
          ? start.assistantMessageId
          : null;
    if (nextId == null || (message.id === nextId && message.createdAt === start.startedAt))
      return message;
    changed = true;
    return { ...message, id: nextId, createdAt: start.startedAt };
  });
  return changed ? reconciled : (current as T[]);
}

export function claimPendingId(pending: Set<string>, id: string): boolean {
  if (pending.has(id)) return false;
  pending.add(id);
  return true;
}
