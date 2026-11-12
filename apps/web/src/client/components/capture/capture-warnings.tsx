import { useI18n, type I18nKey } from '../../lib/i18n';

const WARNINGS = {
  speech_not_transcribed: 'capture.warning.speech_not_transcribed',
  frames_unavailable: 'capture.warning.frames_unavailable',
  images_not_described: 'capture.warning.images_not_described',
} satisfies Record<string, I18nKey>;

/** Public partial-result diagnostics survive navigation into the document. */
export function CaptureWarnings({
  codes,
  announce = false,
}: {
  codes: readonly unknown[];
  announce?: boolean;
}): React.ReactElement | null {
  const { t } = useI18n();
  const keys = [
    ...new Set(
      codes.flatMap((code) =>
        typeof code === 'string' && Object.hasOwn(WARNINGS, code)
          ? [WARNINGS[code as keyof typeof WARNINGS]]
          : [],
      ),
    ),
  ];
  if (!keys.length) return null;
  return (
    <ul
      role={announce ? 'status' : undefined}
      className="space-y-1 text-sm leading-relaxed text-[var(--color-app-warning-fg)]"
    >
      {keys.map((key) => (
        <li key={key}>{t(key)}</li>
      ))}
    </ul>
  );
}
