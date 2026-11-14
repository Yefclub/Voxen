// ============================================================================
// Publication of captured documents — contract v2, target DOCUMENT (spec 220)
// ============================================================================
// New capture: ingest key `capture:<jobId>` (producer `voxen-capture`) maps to
// a transcript id derived from the job id, so replaying the publish step of
// the same job returns the same document and writes the same storage keys.
// Reprocess: updates the existing transcript in place, snapshotting the
// previous canonical text as a SourceContentVersion first.
// Markdown objects are content-addressed inside each source version, so a late
// duplicate attempt cannot overwrite the committed document's evidence bytes.
// ============================================================================

import { createHash } from 'node:crypto';

import type {
  Prisma,
  TranscriptionMethod,
  TranscriptSource,
} from '../../../prisma-generated/client';
import { db } from '../db';
import { invalidateGraphCache } from '../graph-cache';
import { claimIngestKey, PREPARED_DOCUMENT_CONTRACT_VERSION } from '../prepared-ingest';
import { storageGet, storagePut } from '../storage';
import { applyTagsToTranscript } from '../tags';
import { invalidateTranscriptReadCache, TranscriptReadError } from '../transcript-content';
import { buildCaptureMarkdown } from './markdown';
import type { CaptureArtifact, CaptureInterpretation } from './types';
import type { SourceEvidenceManifest } from '../source-provenance';

export const CAPTURE_PRODUCER_ID = 'voxen-capture';

export type PublishInput = {
  jobId: string;
  userId: string;
  refreshTranscriptId: string | null;
  sourceUrl: string;
  artifact: CaptureArtifact;
  interpretation: CaptureInterpretation;
  method: TranscriptionMethod;
  model: string | null;
  costUsd: number | null;
};

export type PublishResult = { transcriptId: string; created: boolean; changed: boolean };

export function captureIngestKey(jobId: string): string {
  return `capture:${jobId}`;
}

/** Deterministic 25-char hex id so retries of one job never fork a document. */
export function captureTranscriptId(jobId: string): string {
  return createHash('sha256').update(`voxen-capture:${jobId}`).digest('hex').slice(0, 25);
}

export function sourceChecksum(plainText: string): string {
  return createHash('sha256')
    .update(plainText.split(/\s+/).filter(Boolean).join(' '), 'utf8')
    .digest('hex');
}

export function sourceVersionKey(
  userId: string,
  transcriptId: string,
  version: number,
  canonicalChecksum: string,
): string {
  return `workspaces/${userId}/transcripts/${transcriptId}/sources/v${version}-${canonicalChecksum}.md`;
}

const SOURCE_BY_PLATFORM: Record<CaptureArtifact['platform'], TranscriptSource> = {
  youtube: 'YOUTUBE',
  tiktok: 'TIKTOK',
  instagram: 'INSTAGRAM',
  x: 'X',
  web: 'WEB',
  other: 'WEB',
  upload: 'UPLOAD',
};

const MD_SOURCE: Record<
  TranscriptSource,
  'youtube' | 'instagram' | 'tiktok' | 'x' | 'web' | 'upload'
> = {
  YOUTUBE: 'youtube',
  INSTAGRAM: 'instagram',
  TIKTOK: 'tiktok',
  X: 'x',
  WEB: 'web',
  UPLOAD: 'upload',
};

const MD_METHOD: Record<
  TranscriptionMethod,
  'subtitles' | 'scrape' | 'api' | 'vision' | 'document'
> = {
  API: 'api',
  SUBTITLES: 'subtitles',
  SCRAPE: 'scrape',
  VISION: 'vision',
  DOCUMENT: 'document',
  X_SEARCH: 'scrape',
};

const IMAGE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeLanguage(value: string | null | undefined): string {
  const code = (value ?? '').toLowerCase().slice(0, 2);
  return /^[a-z]{2}$/.test(code) ? code : 'pt';
}

async function copyPreview(
  userId: string,
  transcriptId: string,
  artifact: CaptureArtifact,
): Promise<{ key: string; mime: string } | null> {
  // A video upload has no thumbnail: its first keyframe is the preview.
  const image = [...artifact.images, ...(artifact.frames ?? [])].find(
    (item) => IMAGE_EXT[item.mime],
  );
  if (!image) return null;
  try {
    const object = await storageGet(image.key);
    const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
    const key = `workspaces/${userId}/transcripts/${transcriptId}/thumbnail.${IMAGE_EXT[image.mime]}`;
    await storagePut({ key, body: bytes, contentType: image.mime, maxBytes: 5 * 1024 * 1024 });
    return { key, mime: image.mime };
  } catch {
    return null;
  }
}

type DocumentFields = {
  url: string;
  title: string;
  channel: string | null;
  author: string | null;
  durationSec: number;
  publishedAt: Date | null;
  language: string;
  source: TranscriptSource;
};

function documentFields(input: PublishInput, fallbackSource?: TranscriptSource): DocumentFields {
  const { artifact, interpretation } = input;
  const title = (interpretation.title || artifact.title || input.sourceUrl)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
  return {
    url: artifact.canonicalUrl ?? input.sourceUrl,
    title,
    channel: artifact.channel?.slice(0, 300) ?? null,
    author: artifact.author?.slice(0, 300) ?? null,
    durationSec: Math.max(0, Math.round(artifact.durationSec ?? 0)),
    publishedAt: parseDate(artifact.publishedAt),
    language: normalizeLanguage(interpretation.language || artifact.language),
    source:
      artifact.platform === 'upload' && fallbackSource
        ? fallbackSource
        : SOURCE_BY_PLATFORM[artifact.platform],
  };
}

function sourceMetadata(
  input: PublishInput,
  evidenceManifest: SourceEvidenceManifest,
): Prisma.InputJsonValue {
  const { artifact } = input;
  return {
    producer: CAPTURE_PRODUCER_ID,
    evidenceManifest,
    contractVersion: PREPARED_DOCUMENT_CONTRACT_VERSION,
    jobId: input.jobId,
    platform: artifact.platform,
    platformId: artifact.platformId,
    extractor: artifact.extractor,
    textKind: artifact.textKind,
    submittedUrl: artifact.submittedUrl ?? input.sourceUrl,
    canonicalUrl: artifact.canonicalUrl,
    keyPoints: input.interpretation.keyPoints,
    entities: input.interpretation.entities,
    sttModel: artifact.stt?.model ?? null,
    visionModel: artifact.visionModel ?? null,
  };
}

async function renderAndStore(
  input: PublishInput,
  transcriptId: string,
  version: number,
  fields: DocumentFields,
  thumbnail: string | null,
): Promise<{
  mdPath: string;
  plainText: string;
  checksum: string;
  evidenceManifest: SourceEvidenceManifest;
}> {
  const { markdown, plainText, evidenceManifest } = buildCaptureMarkdown({
    id: transcriptId,
    userId: input.userId,
    source: MD_SOURCE[fields.source],
    url: fields.url,
    platformId: input.artifact.platformId,
    title: fields.title,
    channel: fields.channel,
    author: fields.author,
    durationSec: fields.durationSec,
    publishedAt: fields.publishedAt,
    thumbnail,
    language: fields.language,
    method: MD_METHOD[input.method],
    model: input.model,
    costUsd: input.costUsd,
    transcribedAt: new Date(),
    artifact: input.artifact,
    interpretation: input.interpretation,
  });
  const mdPath = sourceVersionKey(
    input.userId,
    transcriptId,
    version,
    evidenceManifest.canonicalChecksum,
  );
  await storagePut({ key: mdPath, body: markdown, contentType: 'text/markdown; charset=utf-8' });
  return { mdPath, plainText, checksum: sourceChecksum(plainText), evidenceManifest };
}

async function finishTags(userId: string, transcriptId: string, tags: string[]): Promise<void> {
  const fresh = await db.transcript.findFirst({
    where: { id: transcriptId, userId },
    select: {
      id: true,
      folderId: true,
      correctionRevision: true,
      sourceVersion: true,
      sourceChecksum: true,
    },
  });
  if (fresh && tags.length > 0) await applyTagsToTranscript(userId, fresh, tags);
  invalidateTranscriptReadCache(userId, transcriptId);
  await invalidateGraphCache(userId).catch(() => {});
}

async function publishNew(input: PublishInput): Promise<PublishResult> {
  const transcriptId = captureTranscriptId(input.jobId);
  const existingKey = await db.preparedIngestKey.findUnique({
    where: { userId_key: { userId: input.userId, key: captureIngestKey(input.jobId) } },
    select: { targetId: true },
  });
  if (existingKey) {
    // A crash after the commit may have skipped tagging; tagging is idempotent.
    await finishTags(input.userId, existingKey.targetId, input.interpretation.tags);
    return { transcriptId: existingKey.targetId, created: false, changed: false };
  }

  const fields = documentFields(input);
  const preview = await copyPreview(input.userId, transcriptId, input.artifact);
  const thumbnail = preview ? `/api/transcripts/${transcriptId}/preview` : null;
  const stored = await renderAndStore(input, transcriptId, 1, fields, thumbnail);

  const created = await db.$transaction(async (tx) => {
    const claim = await claimIngestKey(tx, {
      userId: input.userId,
      key: captureIngestKey(input.jobId),
      targetType: 'DOCUMENT',
      targetId: transcriptId,
      producerId: CAPTURE_PRODUCER_ID,
      externalId: input.jobId,
      contractVersion: PREPARED_DOCUMENT_CONTRACT_VERSION,
    });
    if (!claim.created) return false;
    await tx.transcript.create({
      data: {
        id: transcriptId,
        userId: input.userId,
        source: fields.source,
        url: fields.url,
        title: fields.title,
        channel: fields.channel,
        author: fields.author,
        durationSec: fields.durationSec,
        publishedAt: fields.publishedAt,
        thumbnailUrl: thumbnail,
        previewObjectKey: preview?.key ?? null,
        previewMimeType: preview?.mime ?? null,
        originalObjectKey: input.artifact.upload?.objectKey ?? null,
        originalFilename: input.artifact.upload?.filename ?? null,
        originalMimeType: input.artifact.upload?.mimeType ?? null,
        language: fields.language,
        transcriptionMethod: input.method,
        model: input.model,
        costUsd: input.costUsd,
        mdPath: stored.mdPath,
        plainText: stored.plainText,
        summaryMd: input.interpretation.summaryMd,
        summaryStatus: 'COMPLETE',
        taggingStatus: 'COMPLETE',
        frontmatter: {
          id: transcriptId,
          source: fields.source,
          url: fields.url,
          title: fields.title,
          language: fields.language,
          transcriptionMethod: input.method,
          producer: CAPTURE_PRODUCER_ID,
        },
        sourceChecksum: stored.checksum,
        sourceVersion: 1,
        sourceCollectedAt: new Date(),
        sourceMetadata: sourceMetadata(input, stored.evidenceManifest),
      },
    });
    if (input.artifact.segments.length > 0) {
      await tx.chunk.createMany({
        data: input.artifact.segments
          .filter((segment) => segment.text.trim())
          .map((segment) => ({
            transcriptId,
            startSec: Math.floor(segment.startSec),
            endSec: Math.ceil(segment.endSec),
            text: segment.text.trim(),
          })),
      });
    }
    await tx.job.updateMany({
      where: { id: input.jobId, userId: input.userId },
      data: { transcriptId },
    });
    return true;
  });
  await finishTags(input.userId, transcriptId, input.interpretation.tags);
  return { transcriptId, created, changed: created };
}

async function publishRefresh(input: PublishInput, refreshId: string): Promise<PublishResult> {
  const current = await db.transcript.findFirst({
    where: { id: refreshId, userId: input.userId },
    select: {
      id: true,
      source: true,
      mdPath: true,
      plainText: true,
      sourceChecksum: true,
      sourceVersion: true,
      sourceMetadata: true,
      previewObjectKey: true,
      previewMimeType: true,
      thumbnailUrl: true,
    },
  });
  if (!current) throw new Error('Reprocess target no longer exists.');
  const currentMeta = (current.sourceMetadata ?? {}) as Record<string, unknown>;
  if (currentMeta.jobId === input.jobId) {
    // Replay of a publish that already committed: do not bump the version again.
    await finishTags(input.userId, refreshId, input.interpretation.tags);
    return { transcriptId: refreshId, created: false, changed: false };
  }
  const fields = documentFields(input, current.source);
  const baseline = Math.max(1, current.sourceVersion);
  const nextVersion = baseline + 1;
  const preview = (await copyPreview(input.userId, refreshId, input.artifact)) ?? null;
  const thumbnail = preview ? `/api/transcripts/${refreshId}/preview` : current.thumbnailUrl;
  const stored = await renderAndStore(input, refreshId, nextVersion, fields, thumbnail);
  const previousChecksum = current.sourceChecksum ?? sourceChecksum(current.plainText);

  const refreshed = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`voxen:reprocess:${refreshId}`}))`;
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Transcript" WHERE id = ${refreshId} AND "userId" = ${input.userId}
      FOR UPDATE
    `;
    if (!locked.length) throw new Error('Reprocess target no longer exists.');
    const latest = await tx.transcript.findFirstOrThrow({
      where: { id: refreshId, userId: input.userId },
      select: {
        sourceVersion: true,
        sourceChecksum: true,
        mdPath: true,
        plainText: true,
        sourceMetadata: true,
      },
    });
    if ((latest.sourceMetadata as Record<string, unknown> | null)?.jobId === input.jobId)
      return false;
    if (
      latest.sourceVersion !== current.sourceVersion ||
      latest.sourceChecksum !== current.sourceChecksum ||
      latest.mdPath !== current.mdPath ||
      latest.plainText !== current.plainText ||
      JSON.stringify(latest.sourceMetadata) !== JSON.stringify(current.sourceMetadata)
    )
      throw new TranscriptReadError(
        'STALE_REVISION',
        'Reprocess source changed before publication.',
      );
    await tx.sourceContentVersion.createMany({
      data: [
        {
          userId: input.userId,
          transcriptId: refreshId,
          version: baseline,
          checksum: previousChecksum,
          mdPath: latest.mdPath,
          plainText: latest.plainText,
          metadata: (latest.sourceMetadata ?? {}) as Prisma.InputJsonValue,
        },
      ],
      skipDuplicates: true,
    });
    // Tags are additive on reprocess: manual tags the user added stay.
    await tx.chunk.deleteMany({ where: { transcriptId: refreshId } });
    await tx.transcript.update({
      where: { id: refreshId, userId: input.userId },
      data: {
        url: fields.url,
        title: fields.title,
        channel: fields.channel,
        author: fields.author,
        durationSec: fields.durationSec,
        publishedAt: fields.publishedAt,
        thumbnailUrl: thumbnail,
        previewObjectKey: preview?.key ?? current.previewObjectKey,
        previewMimeType: preview?.mime ?? current.previewMimeType,
        language: fields.language,
        transcriptionMethod: input.method,
        model: input.model,
        costUsd: input.costUsd,
        mdPath: stored.mdPath,
        plainText: stored.plainText,
        summaryMd: input.interpretation.summaryMd,
        summaryStatus: 'COMPLETE',
        summaryError: null,
        summaryAttempts: 0,
        taggingStatus: 'COMPLETE',
        taggingError: null,
        taggingAttempts: 0,
        flowchartMd: null,
        sourceChecksum: stored.checksum,
        sourceVersion: nextVersion,
        sourceCollectedAt: new Date(),
        sourceMetadata: sourceMetadata(input, stored.evidenceManifest),
        sourceRefreshStatus: 'CURRENT',
        sourceRefreshError: null,
      },
    });
    await tx.$executeRaw`
      UPDATE "Transcript"
      SET "correctionState" = 'STALE'::"TranscriptCorrectionState",
          "correctionStaleReason" = 'source-version-changed'
      WHERE id = ${refreshId} AND "userId" = ${input.userId} AND "correctionRevision" > 0
    `;
    if (input.artifact.segments.length > 0) {
      await tx.chunk.createMany({
        data: input.artifact.segments
          .filter((segment) => segment.text.trim())
          .map((segment) => ({
            transcriptId: refreshId,
            startSec: Math.floor(segment.startSec),
            endSec: Math.ceil(segment.endSec),
            text: segment.text.trim(),
          })),
      });
    }
    return true;
  });
  await finishTags(input.userId, refreshId, input.interpretation.tags);
  return {
    transcriptId: refreshId,
    created: false,
    changed: refreshed && stored.checksum !== previousChecksum,
  };
}

export async function publishCapturedDocument(input: PublishInput): Promise<PublishResult> {
  return input.refreshTranscriptId
    ? publishRefresh(input, input.refreshTranscriptId)
    : publishNew(input);
}
