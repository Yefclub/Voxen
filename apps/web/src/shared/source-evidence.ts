export const SOURCE_EVIDENCE_AUTHORITIES = [
  'CAPTURED_SOURCE',
  'USER_CORRECTED',
  'PREPARED_DOCUMENT',
] as const;
export type SourceEvidenceAuthority = (typeof SOURCE_EVIDENCE_AUTHORITIES)[number];

/** A missing legacy classification remains absent on public read contracts. */
export function serializeEvidenceAuthority<
  T extends { authority?: SourceEvidenceAuthority | null },
>(source: T) {
  const { authority, ...rest } = source;
  return { ...rest, ...(authority ? { authority } : {}) };
}
