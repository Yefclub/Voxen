export function mergeChatMessagePages<T extends { id: string; createdAt: string }>(
  current: readonly T[],
  incoming: readonly T[],
): T[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    const existing = byId.get(message.id);
    byId.set(
      message.id,
      existing && JSON.stringify(existing) === JSON.stringify(message) ? existing : message,
    );
  }
  const merged = [...byId.values()].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  if (
    merged.length === current.length &&
    merged.every((message, index) => message === current[index])
  )
    return current as T[];
  return merged;
}
