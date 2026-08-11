export type LibraryQueryPatch = Partial<{
  q: string | null;
  page: number | null;
  period: string | null;
  status: string | null;
  view: string | null;
  folderId: string | null;
  tagId: string | null;
}>;

export type LibraryPageItem = number | 'start-gap' | 'end-gap';

export const MAX_LIBRARY_PAGE = 10_000;

export interface LibraryPageState {
  page: number;
  canonicalParam: string | null;
  isCanonical: boolean;
}

export function normalizeLibraryRequestQuery(value: string): string {
  return value.trim().slice(0, 240);
}

export function isCurrentLibraryResponse(input: {
  resolvedPath: string | null;
  requestedPath: string;
  responseQuery: string | undefined;
  requestedQuery: string;
  responseOffset: number | undefined;
  requestedOffset: number;
}): boolean {
  return (
    input.resolvedPath === input.requestedPath &&
    input.responseQuery === input.requestedQuery &&
    input.responseOffset === input.requestedOffset
  );
}

export function libraryPageStateFromParams(params: URLSearchParams): LibraryPageState {
  const raw = params.get('page');
  const parsed = raw && /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  const page = Number.isSafeInteger(parsed) && parsed >= 1 ? Math.min(parsed, MAX_LIBRARY_PAGE) : 1;
  const canonicalParam = page === 1 ? null : String(page);
  return {
    page,
    canonicalParam,
    isCanonical: raw === canonicalParam,
  };
}

export function libraryPageFromParams(params: URLSearchParams): number {
  return libraryPageStateFromParams(params).page;
}

export function updateLibraryParams(
  current: URLSearchParams,
  patch: LibraryQueryPatch,
  options: { resetPage?: boolean } = {},
): URLSearchParams {
  const next = new URLSearchParams(current);
  if (options.resetPage !== false && !Object.hasOwn(patch, 'page')) next.delete('page');

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null || value === '' || (key === 'page' && value === 1)) {
      next.delete(key);
      continue;
    }
    next.set(key, String(value));
  }
  return next;
}

export function buildLibraryPageItems(currentPage: number, pageCount: number): LibraryPageItem[] {
  const total = Math.max(1, Math.floor(pageCount));
  const current = Math.min(total, Math.max(1, Math.floor(currentPage)));
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, 'end-gap', total];
  if (current >= total - 3) {
    return [1, 'start-gap', total - 4, total - 3, total - 2, total - 1, total];
  }
  return [
    1,
    'start-gap',
    current - 2,
    current - 1,
    current,
    current + 1,
    current + 2,
    'end-gap',
    total,
  ];
}
