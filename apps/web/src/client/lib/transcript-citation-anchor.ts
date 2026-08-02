export type CitationTranscriptSegment = { startSec: number; line: number };

/** Resolve timestamp para o último segmento iniciado antes dele e linha para o
 * último segmento cuja linha inicial não excede a âncora. */
export function resolveTranscriptCitationAnchor(
  segments: readonly CitationTranscriptSegment[],
  hash: string,
): number | null {
  const time = Number(/^#t=(\d+)$/.exec(hash)?.[1]);
  if (Number.isInteger(time) && time >= 0) {
    return [...segments].reverse().find((segment) => segment.startSec <= time)?.line ?? null;
  }
  const line = Number(/^#l=(\d+)$/.exec(hash)?.[1]);
  if (Number.isInteger(line) && line >= 1) {
    return [...segments].reverse().find((segment) => segment.line <= line)?.line ?? null;
  }
  return null;
}
