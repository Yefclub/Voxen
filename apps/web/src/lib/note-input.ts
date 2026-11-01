// ============================================================================
// Note HTTP input schemas (spec 216) — shared to keep route files small.
// ============================================================================
// CreateBody accepts the v1 prepared-content contract (idempotency + generic
// document metadata); both are valid only for kind NOTE. PatchBody carries
// revision-guarded curation edits (title/content/move/sources).

import { z } from 'zod';
import { NoteAnchorInputSchema } from './note-anchors';
import { PreparedNoteMetadataSchema } from './prepared-note-ingest';

export const CreateBody = z.object({
  parentId: z.string().nullable().optional(),
  sourceType: z.enum(['TRANSCRIPT']).optional(),
  sourceId: z.string().optional(),
  sourceTranscriptIds: z.array(z.string().min(1)).max(50).optional(),
  sourceAnchors: z.array(NoteAnchorInputSchema).max(100).optional(),
  kind: z.enum(['NOTE', 'FOLDER']).default('NOTE'),
  title: z.string().min(1).max(200),
  content: z.string().max(200_000).optional(),
  // Contrato de ingestão v1 (spec 216): retentativas com a mesma chave
  // devolvem a nota original em vez de duplicar. Válido só para NOTE.
  contract_version: z.string().max(16).optional(),
  idempotency_key: z.string().max(128).optional(),
  producer_id: z.string().max(128).optional(),
  external_id: z.string().max(256).optional(),
  // Metadados genéricos do documento preparado (spec 216 §2): proveniência
  // do documento externo, sem valores fabricados de mídia. Válido só p/ NOTE.
  metadata: PreparedNoteMetadataSchema.optional(),
});

export const PatchBody = z
  .object({
    expectedRevision: z.number().int().min(1),
    parentId: z.string().nullable().optional(),
    title: z.string().min(1).max(200).optional(),
    content: z.string().max(200_000).optional(),
    sourceTranscriptIds: z.array(z.string().min(1)).max(50).optional(),
    sourceAnchors: z.array(NoteAnchorInputSchema).max(100).optional(),
  })
  .refine(
    (value) =>
      value.parentId !== undefined ||
      value.title !== undefined ||
      value.content !== undefined ||
      value.sourceTranscriptIds !== undefined ||
      value.sourceAnchors !== undefined,
  );
