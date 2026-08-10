import { createHash } from 'node:crypto';
import { z } from 'zod';
import { db } from './db';
import { normalizeForMatch, verifyClaimAgainstMd } from './retrieval';
import { storageReadText } from './storage';

export const NoteAnchorInputSchema = z
  .object({
    transcriptId: z.string().min(1),
    startLine: z.number().int().min(1).optional(),
    endLine: z.number().int().min(1).optional(),
    startSec: z.number().int().min(0).optional(),
    endSec: z.number().int().min(0).optional(),
    selectedQuote: z.string().trim().min(1).max(20_000),
    sourceVersion: z.number().int().min(0).optional(),
    sourceChecksum: z.string().max(256).nullable().optional(),
  })
  .superRefine((anchor, context) => {
    if ((anchor.startLine === undefined) !== (anchor.endLine === undefined)) {
      context.addIssue({ code: 'custom', message: 'Line anchors require startLine and endLine.' });
    }
    if ((anchor.startSec === undefined) !== (anchor.endSec === undefined)) {
      context.addIssue({ code: 'custom', message: 'Time anchors require startSec and endSec.' });
    }
    if (anchor.startLine !== undefined && anchor.endLine! < anchor.startLine) {
      context.addIssue({ code: 'custom', message: 'endLine must be greater than startLine.' });
    }
    if (anchor.startSec !== undefined && anchor.endSec! < anchor.startSec) {
      context.addIssue({ code: 'custom', message: 'endSec must be greater than startSec.' });
    }
    if (anchor.startLine === undefined && anchor.startSec === undefined) {
      context.addIssue({ code: 'custom', message: 'An anchor requires a line or time range.' });
    }
  });

export type NoteAnchorInput = z.infer<typeof NoteAnchorInputSchema>;

export interface ValidatedNoteAnchor {
  transcriptId: string;
  startLine: number | null;
  endLine: number | null;
  startSec: number | null;
  endSec: number | null;
  selectedQuote: string;
  quoteHash: string;
  sourceVersion: number;
  sourceChecksum: string | null;
  status: 'VALID';
}

export class NoteAnchorValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoteAnchorValidationError';
  }
}

interface AnchorTranscript {
  id: string;
  title: string;
  mdPath: string;
  plainText: string;
  durationSec: number;
  sourceVersion: number;
  sourceChecksum: string | null;
  correctedMarkdown?: string | null;
  correctionState?: string;
}

interface NoteAnchorDependencies {
  findTranscripts?: (userId: string, ids: readonly string[]) => Promise<AnchorTranscript[]>;
  readText?: (key: string) => Promise<string>;
}

export async function validateNoteAnchors(
  userId: string,
  inputs: readonly NoteAnchorInput[],
  dependencies: NoteAnchorDependencies = {},
): Promise<ValidatedNoteAnchor[]> {
  if (inputs.length > 100) throw new NoteAnchorValidationError('Too many anchors.');
  const parsed = z.array(NoteAnchorInputSchema).safeParse(inputs);
  if (!parsed.success)
    throw new NoteAnchorValidationError(parsed.error.issues[0]?.message ?? 'Invalid anchor.');
  if (parsed.data.length === 0) return [];

  const ids = [...new Set(parsed.data.map((anchor) => anchor.transcriptId))];
  const transcripts = dependencies.findTranscripts
    ? await dependencies.findTranscripts(userId, ids)
    : await db.transcript.findMany({
        where: { id: { in: ids }, userId, status: { not: 'TRASH' } },
        select: {
          id: true,
          title: true,
          mdPath: true,
          plainText: true,
          durationSec: true,
          sourceVersion: true,
          sourceChecksum: true,
          correctedMarkdown: true,
          correctionState: true,
        },
      });
  if (transcripts.length !== ids.length) {
    throw new NoteAnchorValidationError('Transcript not found.');
  }
  const byId = new Map(transcripts.map((transcript) => [transcript.id, transcript]));
  const markdown = new Map<string, string>();

  const result: ValidatedNoteAnchor[] = [];
  for (const anchor of parsed.data) {
    const transcript = byId.get(anchor.transcriptId)!;
    if (anchor.sourceVersion !== undefined && anchor.sourceVersion !== transcript.sourceVersion) {
      throw new NoteAnchorValidationError(
        'The source version changed before the annotation was saved.',
      );
    }
    if (
      anchor.sourceChecksum !== undefined &&
      anchor.sourceChecksum !== transcript.sourceChecksum
    ) {
      throw new NoteAnchorValidationError(
        'The source checksum changed before the annotation was saved.',
      );
    }
    let md = markdown.get(transcript.id);
    if (!md) {
      md =
        transcript.correctionState === 'ACTIVE' && typeof transcript.correctedMarkdown === 'string'
          ? transcript.correctedMarkdown
          : await (dependencies.readText ?? storageReadText)(transcript.mdPath).catch(
              () => `# ${transcript.title}\n\n${transcript.plainText}`,
            );
      markdown.set(transcript.id, md);
    }
    const lineCount = md.split('\n').length;
    if (anchor.endLine !== undefined && anchor.endLine > lineCount) {
      throw new NoteAnchorValidationError('The line range is outside the transcript.');
    }
    if (
      anchor.endSec !== undefined &&
      transcript.durationSec > 0 &&
      anchor.endSec > transcript.durationSec
    ) {
      throw new NoteAnchorValidationError('The time range is outside the transcript.');
    }
    if (!noteAnchorMatchesMarkdown(anchor, md)) {
      throw new NoteAnchorValidationError(
        'The selected quote does not match the referenced passage.',
      );
    }
    const normalized = normalizeForMatch(anchor.selectedQuote);
    result.push({
      transcriptId: transcript.id,
      startLine: anchor.startLine ?? null,
      endLine: anchor.endLine ?? null,
      startSec: anchor.startSec ?? null,
      endSec: anchor.endSec ?? null,
      selectedQuote: anchor.selectedQuote.trim(),
      quoteHash: createHash('sha256').update(normalized).digest('hex'),
      sourceVersion: transcript.sourceVersion,
      sourceChecksum: transcript.sourceChecksum,
      status: 'VALID',
    });
  }
  return result;
}

export function noteAnchorMatchesMarkdown(
  anchor: {
    selectedQuote: string;
    startLine?: number | null;
    endLine?: number | null;
    startSec?: number | null;
    endSec?: number | null;
  },
  markdown: string,
): boolean {
  return verifyClaimAgainstMd(markdown, {
    quote: anchor.selectedQuote,
    fromLine: anchor.startLine ?? undefined,
    toLine: anchor.endLine ?? undefined,
    fromSec: anchor.startSec ?? undefined,
    toSec: anchor.endSec ?? undefined,
  }).supported;
}

export function noteSourceCreateData(
  userId: string,
  transcriptIds: readonly string[],
  anchors: readonly ValidatedNoteAnchor[],
) {
  const allIds = [...new Set([...transcriptIds, ...anchors.map((anchor) => anchor.transcriptId)])];
  return allIds.map((transcriptId) => ({
    transcriptId,
    userId,
    anchors: {
      create: anchors
        .filter((anchor) => anchor.transcriptId === transcriptId)
        .map(({ transcriptId: _transcriptId, ...anchor }) => ({ ...anchor, userId })),
    },
  }));
}
