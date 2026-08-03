export type UpdateModalIntent = 'apply' | 'defer' | 'dismiss' | 'open-changelog';
export type UpdateModalEffect = 'apply' | 'snooze' | 'navigate' | 'none';
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
  if (intent === 'open-changelog') return 'navigate';
  if (intent === 'apply') return state.streaming ? 'none' : 'apply';
  return 'snooze';
}

/**
 * Silent apply policy: when an update is known and the chat is not streaming,
 * the shell applies without showing the modal. The modal is reserved only for
 * cases where silent apply cannot run yet (streaming) — and even then we wait
 * rather than block the user with a dialog; presentation stays off.
 */
export function shouldSilentApplyVersion({
  hasUpdate,
  streaming,
}: {
  hasUpdate: boolean;
  streaming: boolean;
}): boolean {
  return hasUpdate && !streaming;
}

export function shouldPresentUpdateModal({
  hasUpdate,
  streaming,
  pathname,
}: {
  hasUpdate: boolean;
  streaming: boolean;
  pathname: string;
}): boolean {
  // Modal no longer gates updates: silent apply handles !streaming.
  // Keep the helper so existing call sites and tests document the policy.
  void hasUpdate;
  void streaming;
  void pathname;
  return false;
}

export function resolveReleaseView(loadState: ReleaseLoadState, hasRelease: boolean): ReleaseView {
  if (loadState === 'loading') return 'loading';
  if (loadState === 'error') return 'error';
  return hasRelease ? 'release' : 'empty';
}
