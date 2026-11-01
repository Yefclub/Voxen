/** Pure tag slugifier: Unicode-normalized, lowercased, hyphen-joined, capped. */

export function slugifyTag(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove diacríticos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // não-alfanumérico → hífen
    .replace(/^-+|-+$/g, '') // trim hífens
    .slice(0, 60);
}

export function orderUniqueTagNames(tagNames: string[]): Array<{ name: string; slug: string }> {
  const bySlug = new Map<string, string>();
  for (const rawName of tagNames) {
    const name = rawName.trim();
    const slug = slugifyTag(name);
    if (!slug) continue;
    const current = bySlug.get(slug);
    if (current === undefined || name < current) bySlug.set(slug, name);
  }
  return [...bySlug.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([slug, name]) => ({ name, slug }));
}

export function pickFolderId(current: string | null, candidate: string | null): string | null {
  return current ?? candidate;
}
