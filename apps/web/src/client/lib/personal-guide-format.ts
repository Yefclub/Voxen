export function formatGuidePercent(value: number): string {
  const finite = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  return `${Math.round(finite * 100)}%`;
}

export function formatGuideSignedPercent(value: number): string {
  const finite = Number.isFinite(value) ? value : 0;
  const percentage = Math.round(finite * 100);
  return `${percentage > 0 ? '+' : ''}${percentage}%`;
}
