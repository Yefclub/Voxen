export type UpdateModalIntent = 'apply' | 'defer' | 'dismiss' | 'open-changelog';
export type UpdateModalEffect = 'apply' | 'snooze' | 'none';
export type ReleaseLoadState = 'loading' | 'ready' | 'error';
export type ReleaseView = 'loading' | 'release' | 'empty' | 'error';

interface ReleaseCopyInput {
  title?: string;
  summary?: string;
  body?: string;
}

export interface ReleaseCopy {
  heading: string | null;
  details: string[];
}

export function resolveReleaseCopy(item: ReleaseCopyInput): ReleaseCopy {
  const title = item.title?.trim() || null;
  const summary = item.summary?.trim() || null;
  const body = item.body?.trim() || null;
  const heading = title ?? summary;
  const details = [summary, body].filter(
    (value, index, values): value is string =>
      value !== null && value !== heading && values.indexOf(value) === index,
  );
  return { heading, details };
}

export function resolveUpdateModalEffect(
  intent: UpdateModalIntent,
  state: { applying: boolean; streaming: boolean },
): UpdateModalEffect {
  if (state.applying) return 'none';
  if (intent === 'apply') return state.streaming ? 'none' : 'apply';
  return 'snooze';
}

export function resolveReleaseView(loadState: ReleaseLoadState, hasRelease: boolean): ReleaseView {
  if (loadState === 'loading') return 'loading';
  if (loadState === 'error') return 'error';
  return hasRelease ? 'release' : 'empty';
}
