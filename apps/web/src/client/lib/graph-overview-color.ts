/** Preblend overview edges so intersecting lines do not accumulate opacity. */
export function overviewEdgeColor(canvas: string, foreground: string): string {
  const base = Number.parseInt(canvas.slice(1), 16);
  const ink = Number.parseInt(foreground.slice(1), 16);
  return `#${[16, 8, 0]
    .map((shift) =>
      Math.round(((base >> shift) & 255) * 0.88 + ((ink >> shift) & 255) * 0.12)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}
