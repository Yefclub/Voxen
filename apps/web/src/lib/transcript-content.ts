import { db } from './db';
import { safeErrorDiagnostic } from './safe-diagnostics';
import { storageReadText } from './storage';

export const TRANSCRIPT_CORRECTION_DETAIL_SELECT = {
  correctionRevision: true,
  correctedMarkdown: true,
  correctedPlainText: true,
  correctedChecksum: true,
  correctionSourceVersion: true,
  correctionSourceChecksum: true,
  correctionState: true,
  correctionStaleReason: true,
} as const;

type EffectivePlainTextInput = {
  plainText: string;
  correctedPlainText: string | null;
  correctionState: string;
};

export function effectiveTranscriptPlainText(input: EffectivePlainTextInput): string {
  return input.correctionState === 'ACTIVE' && input.correctedPlainText
    ? input.correctedPlainText
    : input.plainText;
}

export async function loadEffectiveTranscriptMarkdown(
  userId: string,
  transcriptId: string,
): Promise<{ id: string; title: string; url: string; md: string } | null> {
  const transcript = await db.transcript.findFirst({
    where: { id: transcriptId, userId, status: 'ACTIVE' },
    select: {
      id: true,
      title: true,
      url: true,
      mdPath: true,
      plainText: true,
      correctedMarkdown: true,
      correctionState: true,
    },
  });
  if (!transcript) return null;
  if (transcript.correctionState === 'ACTIVE' && transcript.correctedMarkdown) {
    return {
      id: transcript.id,
      title: transcript.title,
      url: transcript.url,
      md: transcript.correctedMarkdown,
    };
  }
  let markdown: string;
  try {
    markdown = await storageReadText(transcript.mdPath);
    if (!markdown) markdown = `# ${transcript.title}\n\n${transcript.plainText}`;
  } catch {
    markdown = `# ${transcript.title}\n\n${transcript.plainText}`;
  }
  return { id: transcript.id, title: transcript.title, url: transcript.url, md: markdown };
}

export async function resolveTranscriptMarkdownViews(input: {
  title: string;
  mdPath: string;
  plainText: string;
  correctedMarkdown: string | null;
  correctionState: string;
  correctionRevision: number;
}): Promise<{ markdown: string; canonicalMarkdown: string | null }> {
  let canonical: string;
  try {
    canonical = await storageReadText(input.mdPath);
  } catch (error) {
    console.error(
      '[transcripts] erro ao baixar .md',
      safeErrorDiagnostic('TRANSCRIPT_MARKDOWN_READ_FAILED', error),
    );
    canonical = `# ${input.title}\n\n${input.plainText}`;
  }
  return {
    markdown:
      input.correctionState === 'ACTIVE' && input.correctedMarkdown
        ? input.correctedMarkdown
        : canonical,
    canonicalMarkdown: input.correctionRevision > 0 ? canonical : null,
  };
}

export async function loadTranscriptSourceVersions(
  userId: string,
  transcript: { id: string; source: string },
) {
  if (transcript.source !== 'WEB') return [];
  return db.sourceContentVersion.findMany({
    where: { userId, transcriptId: transcript.id },
    orderBy: { version: 'desc' },
    take: 12,
    select: { version: true, checksum: true, collectedAt: true, metadata: true },
  });
}
