/** Parse optional ISO since/until bounds for temporal listing tools (spec 093). */
export function parseTemporalBounds(
  since?: string,
  until?: string,
): { ok: true; since?: Date; until?: Date } | { ok: false; error: string } {
  let sinceDate: Date | undefined;
  let untilDate: Date | undefined;
  if (since !== undefined) {
    sinceDate = new Date(since);
    if (Number.isNaN(sinceDate.getTime())) {
      return { ok: false, error: 'since inválido — use ISO-8601 (ex.: 2026-07-07T00:00:00.000Z).' };
    }
  }
  if (until !== undefined) {
    untilDate = new Date(until);
    if (Number.isNaN(untilDate.getTime())) {
      return { ok: false, error: 'until inválido — use ISO-8601 (ex.: 2026-07-14T00:00:00.000Z).' };
    }
  }
  if (sinceDate && untilDate && untilDate.getTime() <= sinceDate.getTime()) {
    return { ok: false, error: 'until precisa ser posterior a since.' };
  }
  return { ok: true, since: sinceDate, until: untilDate };
}
