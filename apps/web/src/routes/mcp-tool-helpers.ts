export function toMcpContentUrl(publicOrigin: string, href: string): string {
  return new URL(href, `${publicOrigin}/`).toString();
}

export function ok(data: Record<string, unknown>): {
  content: { type: 'text'; text: string }[];
  structuredContent: Record<string, unknown>;
} {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

export function fail(message: string): {
  content: { type: 'text'; text: string }[];
  isError: true;
} {
  return { content: [{ type: 'text', text: message }], isError: true };
}

export function bounded(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.trunc(parsed), max));
}
export const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;
