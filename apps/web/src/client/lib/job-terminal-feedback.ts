/**
 * Decisões puras para feedback de job terminal no PWA:
 * - toast in-app vs notificação de sistema
 * - auto-navegação para a transcrição no DONE focado
 */

export type TerminalJobStage = 'done' | 'completed_with_warnings' | 'failed' | 'cancelled';

export type TerminalFeedbackChannel = 'toast' | 'notification' | 'none';

export type NotificationPermissionState = 'granted' | 'denied' | 'default' | 'unsupported';

export interface ResolveTerminalFeedbackArgs {
  stage: TerminalJobStage;
  documentHidden: boolean;
  notificationPermission: NotificationPermissionState;
}

/**
 * When the document is hidden, prefer a system notification (if allowed) and
 * never enqueue a backlog of in-app toasts. When visible, use Sonner toasts.
 * Cancelled jobs stay quiet in background.
 */
export function resolveTerminalJobFeedback(
  args: ResolveTerminalFeedbackArgs,
): TerminalFeedbackChannel {
  if (args.documentHidden) {
    if (args.stage === 'cancelled') return 'none';
    if (args.notificationPermission === 'granted') return 'notification';
    return 'none';
  }
  return 'toast';
}

export interface SystemNotificationContent {
  title: string;
  body: string;
  icon: string;
  tag: string;
  /** Path to open on notification click (app-relative). */
  url: string;
}

export interface BuildJobNotificationArgs {
  stage: Exclude<TerminalJobStage, 'cancelled'>;
  jobId: string;
  transcriptId?: string | null;
  savedMediaReady?: boolean;
  deletionReady?: boolean;
  errorMsg?: string | null;
  /** Localized strings from i18n. */
  labels: {
    readyTitle: string;
    readyBody: string;
    failedTitle: string;
    failedBody: string;
    mediaReadyTitle?: string;
    mediaReadyBody?: string;
    deletionReadyTitle?: string;
    deletionReadyBody?: string;
  };
  iconUrl?: string;
}

export function buildJobSystemNotification(
  args: BuildJobNotificationArgs,
): SystemNotificationContent {
  const icon = args.iconUrl ?? '/voxen-192.png';
  if (args.stage === 'done' || args.stage === 'completed_with_warnings') {
    const isSavedMedia = args.savedMediaReady === true;
    const isDeletion = args.deletionReady === true;
    return {
      title: isDeletion
        ? (args.labels.deletionReadyTitle ?? args.labels.readyTitle)
        : isSavedMedia
          ? (args.labels.mediaReadyTitle ?? args.labels.readyTitle)
          : args.labels.readyTitle,
      body: isDeletion
        ? (args.labels.deletionReadyBody ?? args.labels.readyBody)
        : isSavedMedia
          ? (args.labels.mediaReadyBody ?? args.labels.readyBody)
          : args.labels.readyBody,
      icon,
      tag: `voxen-job-${args.jobId}-${args.stage}`,
      url: isDeletion
        ? `/jobs/${args.jobId}`
        : args.transcriptId
          ? `/transcricoes/${args.transcriptId}`
          : isSavedMedia
            ? '/downloads'
            : `/jobs/${args.jobId}`,
    };
  }
  return {
    title: args.labels.failedTitle,
    body: args.errorMsg?.trim() || args.labels.failedBody,
    icon,
    tag: `voxen-job-${args.jobId}-failed`,
    url: `/jobs/${args.jobId}`,
  };
}

export interface ShouldAutoOpenTranscriptArgs {
  stage: string;
  transcriptId?: string | null;
  documentHidden: boolean;
  /** Current location pathname (no query/hash). */
  pathname: string;
  jobId: string;
}

/**
 * Auto-open only the focused job detail page while the app is visible.
 * Avoids thrashing when many jobs complete elsewhere.
 */
export function shouldAutoOpenTranscript(args: ShouldAutoOpenTranscriptArgs): string | null {
  if (args.documentHidden) return null;
  if (args.stage !== 'done' && args.stage !== 'DONE') return null;
  const transcriptId = args.transcriptId?.trim();
  if (!transcriptId) return null;

  const path = args.pathname.replace(/\/+$/, '') || '/';
  const jobPath = `/jobs/${args.jobId}`;
  if (path !== jobPath) return null;

  return `/transcricoes/${transcriptId}`;
}

/**
 * Show a system notification via Service Worker when available, else Notification ctor.
 * Never throws to callers — best-effort for L1 PWA feedback.
 */
export async function showSystemNotification(
  content: SystemNotificationContent,
  runtime: {
    getRegistration?: () => Promise<ServiceWorkerRegistration | undefined>;
    NotificationCtor?: typeof Notification | null;
  } = {},
): Promise<boolean> {
  try {
    const getReg =
      runtime.getRegistration ??
      (typeof navigator !== 'undefined' && navigator.serviceWorker
        ? () => navigator.serviceWorker.getRegistration()
        : undefined);
    const reg = getReg ? await getReg() : undefined;
    if (reg?.showNotification) {
      await reg.showNotification(content.title, {
        body: content.body,
        icon: content.icon,
        tag: content.tag,
        data: { url: content.url },
      });
      return true;
    }
    const Notif =
      runtime.NotificationCtor !== undefined
        ? runtime.NotificationCtor
        : typeof Notification !== 'undefined'
          ? Notification
          : null;
    if (Notif && typeof Notif === 'function') {
      // Permission already checked by caller.
      new Notif(content.title, {
        body: content.body,
        icon: content.icon,
        tag: content.tag,
        data: { url: content.url },
      });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function readNotificationPermission(
  Notif: { permission?: string } | null | undefined = typeof Notification !== 'undefined'
    ? Notification
    : null,
): NotificationPermissionState {
  if (!Notif || typeof Notif.permission !== 'string') return 'unsupported';
  if (Notif.permission === 'granted') return 'granted';
  if (Notif.permission === 'denied') return 'denied';
  return 'default';
}

/** Request permission once when default; never throws. */
export async function ensureNotificationPermission(
  Notif: {
    permission?: string;
    requestPermission?: () => Promise<NotificationPermission>;
  } | null = typeof Notification !== 'undefined' ? Notification : null,
): Promise<NotificationPermissionState> {
  if (!Notif || typeof Notif.permission !== 'string') return 'unsupported';
  if (Notif.permission === 'granted') return 'granted';
  if (Notif.permission === 'denied') return 'denied';
  if (typeof Notif.requestPermission !== 'function') return 'default';
  try {
    const result = await Notif.requestPermission();
    if (result === 'granted') return 'granted';
    if (result === 'denied') return 'denied';
    return 'default';
  } catch {
    return 'default';
  }
}
