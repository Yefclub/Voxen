export type CitationTranscriptSegment = { startSec: number; line: number };
export type TranscriptCitationRange = { startLine: number; endLine: number };

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

export function resolveTranscriptCitationRange(
  segments: readonly CitationTranscriptSegment[],
  hash: string,
): TranscriptCitationRange | null {
  const lineMatch = /^#l=(\d+)(?:-(\d+))?$/.exec(hash);
  if (lineMatch) {
    const requestedStart = Number(lineMatch[1]);
    const requestedEnd = Number(lineMatch[2] ?? lineMatch[1]);
    if (
      Number.isInteger(requestedStart) &&
      Number.isInteger(requestedEnd) &&
      requestedStart >= 1 &&
      requestedEnd >= requestedStart
    ) {
      const startLine =
        [...segments].reverse().find((segment) => segment.line <= requestedStart)?.line ?? null;
      const endLine =
        [...segments].reverse().find((segment) => segment.line <= requestedEnd)?.line ?? null;
      return startLine !== null && endLine !== null ? { startLine, endLine } : null;
    }
  }

  const timeMatch = /^#t=(\d+)(?:-(\d+))?$/.exec(hash);
  if (timeMatch) {
    const requestedStart = Number(timeMatch[1]);
    const requestedEnd = Number(timeMatch[2] ?? timeMatch[1]);
    if (
      Number.isInteger(requestedStart) &&
      Number.isInteger(requestedEnd) &&
      requestedStart >= 0 &&
      requestedEnd >= requestedStart
    ) {
      const startLine =
        [...segments].reverse().find((segment) => segment.startSec <= requestedStart)?.line ?? null;
      const endLine =
        [...segments].reverse().find((segment) => segment.startSec <= requestedEnd)?.line ?? null;
      return startLine !== null && endLine !== null ? { startLine, endLine } : null;
    }
  }
  return null;
}
