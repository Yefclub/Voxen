import { NotePatchError } from '../lib/note-revisions';
import { NoteNotFoundError, NoteRevisionConflictError } from '../lib/note-versioning';
import { fail } from './mcp-tool-helpers';

export function noteWriteFailure(error: unknown): ReturnType<typeof fail> | null {
  if (error instanceof NoteRevisionConflictError) {
    return fail(
      `REVISION_CONFLICT: current_revision=${error.currentRevision} ` +
        `current_checksum=${error.currentChecksum}. Read the note again before retrying.`,
    );
  }
  if (error instanceof NoteNotFoundError) return fail('Nota não encontrada (ou fora do escopo).');
  if (error instanceof NotePatchError) {
    return fail(
      `${error.code}: ${error.message}${error.matchCount === undefined ? '' : ` match_count=${error.matchCount}`}`,
    );
  }
  if (error instanceof Error && error.message === 'NOT_FOUND') {
    return fail('Nota não encontrada (ou fora do escopo).');
  }
  return null;
}
