const MINUTE_MS = 60_000;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Returns the next complete local minute in the format expected by a
 * `datetime-local` input. `getTimezoneOffset()` uses UTC minus local time, so
 * the offset must be subtracted before formatting the instant as UTC fields.
 */
export function nextLocalDateTimeInputMin(
  now: Date,
  timezoneOffsetMinutes = now.getTimezoneOffset(),
): string {
  const nextMinute = Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  const local = new Date(nextMinute - timezoneOffsetMinutes * MINUTE_MS);
  return [
    local.getUTCFullYear(),
    '-',
    pad(local.getUTCMonth() + 1),
    '-',
    pad(local.getUTCDate()),
    'T',
    pad(local.getUTCHours()),
    ':',
    pad(local.getUTCMinutes()),
  ].join('');
}
