// ============================================================================
// Capture data shapes shared by the runner, publisher and API (spec 220)
// ============================================================================

export type CaptureSegment = { startSec: number; endSec: number; text: string };

export type CaptureTextKind =
  | 'captions'
  | 'post'
  | 'page'
  | 'description'
  | 'document'
  | 'stt'
  | 'none';

export type CapturePlatformName =
  | 'youtube'
  | 'tiktok'
  | 'instagram'
  | 'x'
  | 'web'
  | 'other'
  | 'upload';

export type CaptureImageRef = {
  kind: string;
  mime: string;
  /** Storage key where the image bytes live (never inline in the artifact). */
  key: string;
  bytes: number;
};

/** Worker extraction result as persisted in the capture artifact. */
export type CaptureArtifact = {
  version: 1;
  platform: CapturePlatformName;
  submittedUrl: string | null;
  canonicalUrl: string | null;
  platformId: string | null;
  title: string | null;
  author: string | null;
  channel: string | null;
  publishedAt: string | null;
  durationSec: number | null;
  language: string | null;
  description: string | null;
  text: string | null;
  textKind: CaptureTextKind;
  segments: CaptureSegment[];
  hasAudio: boolean;
  images: CaptureImageRef[];
  extractor: string | null;
  upload?: { objectKey: string; filename: string; mimeType: string } | null;
  stt?: { model: string; costUsd: number | null; language: string | null } | null;
  imageDescriptions?: Array<{ index: number; description: string }>;
  visionModel?: string | null;
  visionCostUsd?: number | null;
};

export type CaptureInterpretation = {
  title: string;
  language: string;
  summaryMd: string;
  keyPoints: string[];
  tags: string[];
  entities: Array<{ name: string; kind: string }>;
};
