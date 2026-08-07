import { ArrowUp } from '@/components/ui/icons';
import { ICON_CUE_DURATION, type IconCueHandle } from '../../lib/icon-cue';
import { useI18n } from '../../lib/i18n';
import { useReleaseUpdate } from '../../lib/use-release-update';
import { cn } from '../../lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';

interface SidebarReleaseUpdateButtonProps {
  variant?: 'full' | 'rail';
  iconRef?: React.Ref<IconCueHandle>;
}

export function SidebarReleaseUpdateButton({
  variant = 'full',
  iconRef,
}: SidebarReleaseUpdateButtonProps = {}): React.ReactElement | null {
  const { t } = useI18n();
  const status = useReleaseUpdate();
  if (!status?.available || !status.latestTag || !status.releaseUrl) return null;

  const environment = t(
    status.environment === 'dev' ? 'shell.releaseEnvironment.dev' : 'shell.releaseEnvironment.prod',
  );
  const label = t('shell.releaseAvailable', { version: status.latestTag });
  const details = t('shell.releaseDetails', {
    environment,
    current: status.currentVersion,
  });

  if (variant === 'rail') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={status.releaseUrl}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`${label}. ${details}`}
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
              'bg-[var(--color-accent-violet-soft)] text-[var(--color-accent-violet)] hover:brightness-110',
            )}
          >
            <ArrowUp ref={iconRef} duration={ICON_CUE_DURATION} className="h-[18px] w-[18px]" />
          </a>
        </TooltipTrigger>
        <TooltipContent side="right">
          <span className="font-medium">{label}</span>
          <span className="ml-1 text-[var(--color-app-muted)]">· {environment}</span>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className="shrink-0 px-3 py-1.5">
      <a
        href={status.releaseUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-[var(--color-accent-violet)]/25 bg-[var(--color-accent-violet-soft)] px-3 py-2 text-left text-[var(--color-accent-violet)] transition-[filter,transform] hover:brightness-110 active:scale-[0.99]"
      >
        <ArrowUp className="h-4 w-4 shrink-0" />
        <span className="min-w-0">
          <span className="block truncate text-xs font-semibold">{label}</span>
          <span className="block truncate text-[10px] text-[var(--color-app-muted)]">
            {details}
          </span>
        </span>
      </a>
    </div>
  );
}
