/** Organização temporal e estado de filtros da Biblioteca Viva. */

export type LibraryPeriod = 'all' | 'this-week' | 'previous-week';

export type LibraryWeekBounds = { from: string; to: string } | null;

function startOfLocalWeek(value: Date): Date {
  const start = new Date(value);
  start.setHours(0, 0, 0, 0);
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  return start;
}

/** Janela [from, to) da semana ISO local, serializada para a API. */
export function libraryWeekBounds(
  period: LibraryPeriod,
  reference = new Date(),
): LibraryWeekBounds {
  if (period === 'all') return null;
  const end = startOfLocalWeek(reference);
  if (period === 'this-week') {
    const next = new Date(end);
    next.setDate(next.getDate() + 7);
    return { from: end.toISOString(), to: next.toISOString() };
  }
  const previous = new Date(end);
  previous.setDate(previous.getDate() - 7);
  return { from: previous.toISOString(), to: end.toISOString() };
}

export type WeekGroup<T> = { key: string; start: Date; items: T[] };

/** Agrupa uma lista já ordenada em semanas locais para a leitura da Biblioteca. */
export function groupByCaptureWeek<T extends { createdAt: string }>(
  items: readonly T[],
): WeekGroup<T>[] {
  const groups = new Map<string, WeekGroup<T>>();
  for (const item of items) {
    const createdAt = new Date(item.createdAt);
    if (Number.isNaN(createdAt.getTime())) continue;
    const start = startOfLocalWeek(createdAt);
    const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(
      start.getDate(),
    ).padStart(2, '0')}`;
    const group = groups.get(key) ?? { key, start, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.start.getTime() - a.start.getTime());
}
