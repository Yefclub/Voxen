export type ReleaseLocale = 'pt-BR' | 'en';
export type ReleaseEnvironment = 'dev' | 'prod';

export interface ReleaseTranslation {
  title?: string;
  body?: string;
  summary?: string;
}

export interface ReleaseTranslations {
  'pt-BR'?: ReleaseTranslation;
  en?: ReleaseTranslation;
}

export interface ReleaseFeedItem {
  type?: string;
  title?: string;
  body?: string;
  summary?: string;
  pr?: number | null;
  prUrl?: string;
  translations?: ReleaseTranslations;
}

export interface ReleaseFeedEntry extends ReleaseFeedItem {
  version: string;
  channel: string;
  author?: string | null;
  date?: string;
  promoted?: ReleaseFeedItem[];
}

export interface LocalizedReleaseFeedItem extends Omit<
  ReleaseFeedItem,
  'title' | 'body' | 'summary'
> {
  title?: string;
  body?: string;
  summary?: string;
}

export interface LocalizedReleaseFeedEntry extends Omit<
  ReleaseFeedEntry,
  'title' | 'body' | 'summary' | 'promoted'
> {
  title?: string;
  body?: string;
  summary?: string;
  promoted?: LocalizedReleaseFeedItem[];
}

export interface ReleaseFeedQuery {
  channel: 'all' | 'dev' | 'prod';
  type: string | null;
  query: string;
  version: string | null;
  invalidVersion: boolean;
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
  version?: string;
  limit?: string;
  offset?: string;
}): ReleaseFeedQuery {
  const rawChannel = input.channel?.toLowerCase();
  const channel = rawChannel === 'dev' || rawChannel === 'prod' ? rawChannel : 'all';
  const rawType = input.type?.trim().toLowerCase() ?? '';
  const type = RELEASE_TYPES.has(rawType) ? rawType : null;
  const query = input.query?.trim().slice(0, 120) ?? '';
  const versionRequested = input.version !== undefined;
  const rawVersion = input.version?.trim().replace(/^v/iu, '').slice(0, 80) ?? '';
  const version = rawVersion && /^[0-9A-Za-z._+-]+$/u.test(rawVersion) ? rawVersion : null;
  return {
    channel,
    type,
    query,
    version,
    invalidVersion: versionRequested && version === null,
    limit: boundedInteger(input.limit, DEFAULT_RELEASE_PAGE_SIZE, 1, MAX_RELEASE_PAGE_SIZE),
    offset: boundedInteger(input.offset, 0, 0, Number.MAX_SAFE_INTEGER),
  };
}

export function parseReleaseLocale(value: string | undefined): ReleaseLocale {
  return value?.toLowerCase() === 'pt-br' ? 'pt-BR' : 'en';
}

/**
 * The deployment version is the source of truth for the feed channel. Query
 * parameters stay accepted for backwards-compatible URLs, but never widen the
 * release history visible from a given instance.
 */
export function enforceReleaseFeedEnvironment(
  query: ReleaseFeedQuery,
  environment: ReleaseEnvironment,
): ReleaseFeedQuery {
  return { ...query, channel: environment };
}

function localizedValue(
  entry: ReleaseFeedItem,
  field: keyof ReleaseTranslation,
  locale: ReleaseLocale,
): string | undefined {
  const requested = entry.translations?.[locale]?.[field];
  if (requested?.trim()) return requested;
  const english = entry.translations?.en?.[field];
  if (english?.trim()) return english;
  const portuguese = entry.translations?.['pt-BR']?.[field];
  if (portuguese?.trim()) return portuguese;
  const legacy = entry[field];
  return typeof legacy === 'string' && legacy.trim() ? legacy : undefined;
}

/**
 * Resolve a feed entry at the API boundary. Historical string-only entries
 * remain valid while new entries can carry curated content for both locales.
 */
export function localizeReleaseItem(
  entry: ReleaseFeedItem,
  locale: ReleaseLocale,
): LocalizedReleaseFeedItem {
  return {
    ...entry,
    title: localizedValue(entry, 'title', locale),
    body: localizedValue(entry, 'body', locale),
    summary: localizedValue(entry, 'summary', locale),
  };
}

export function localizeReleaseEntry(
  entry: ReleaseFeedEntry,
  locale: ReleaseLocale,
): LocalizedReleaseFeedEntry {
  const { promoted, ...rest } = entry;
  return {
    ...localizeReleaseItem(rest, locale),
    ...(promoted ? { promoted: promoted.map((item) => localizeReleaseItem(item, locale)) } : {}),
  };
}

export function selectReleaseFeedPage<T extends ReleaseFeedEntry>(
  entries: readonly T[],
  query: ReleaseFeedQuery,
): ReleaseFeedPage<T> {
  if (query.invalidVersion) {
    return {
      releases: [],
      total: 0,
      limit: query.limit,
      offset: query.offset,
      hasMore: false,
    };
  }
  const needle = query.query.toLocaleLowerCase();
  const filtered = entries.filter((entry) => {
    if (query.version && entry.version.replace(/^v/iu, '') !== query.version) return false;
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
