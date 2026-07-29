export interface ReleaseFeedEntry {
  version: string;
  channel: string;
  type?: string;
  title?: string;
  body?: string;
  summary?: string;
}

export interface ReleaseFeedQuery {
  channel: 'all' | 'dev' | 'prod';
  type: string | null;
  query: string;
  limit: number;
  offset: number;
}

export interface ReleaseFeedPage<T> {
  releases: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

const MAX_RELEASE_PAGE_SIZE = 50;
const DEFAULT_RELEASE_PAGE_SIZE = 12;
const RELEASE_TYPES = new Set(['feat', 'fix', 'perf', 'ui', 'infra', 'security', 'chore']);

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

export function parseReleaseFeedQuery(input: {
  channel?: string;
  type?: string;
  query?: string;
  limit?: string;
  offset?: string;
}): ReleaseFeedQuery {
  const rawChannel = input.channel?.toLowerCase();
  const channel = rawChannel === 'dev' || rawChannel === 'prod' ? rawChannel : 'all';
  const rawType = input.type?.trim().toLowerCase() ?? '';
  const type = RELEASE_TYPES.has(rawType) ? rawType : null;
  const query = input.query?.trim().slice(0, 120) ?? '';
  return {
    channel,
    type,
    query,
    limit: boundedInteger(input.limit, DEFAULT_RELEASE_PAGE_SIZE, 1, MAX_RELEASE_PAGE_SIZE),
    offset: boundedInteger(input.offset, 0, 0, Number.MAX_SAFE_INTEGER),
  };
}

export function selectReleaseFeedPage<T extends ReleaseFeedEntry>(
  entries: readonly T[],
  query: ReleaseFeedQuery,
): ReleaseFeedPage<T> {
  const needle = query.query.toLocaleLowerCase();
  const filtered = entries.filter((entry) => {
    if (query.channel !== 'all' && entry.channel.toLowerCase() !== query.channel) return false;
    if (query.type && entry.type?.toLowerCase() !== query.type) return false;
    if (!needle) return true;
    return [entry.version, entry.title, entry.summary, entry.body, entry.type]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLocaleLowerCase().includes(needle));
  });
  const releases = filtered.slice(query.offset, query.offset + query.limit);
  return {
    releases,
    total: filtered.length,
    limit: query.limit,
    offset: query.offset,
    hasMore: query.offset + releases.length < filtered.length,
  };
}
