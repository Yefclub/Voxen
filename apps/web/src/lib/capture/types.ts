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
  /** Position of a video keyframe in the source, in seconds (spec 221). */
  timeSec?: number | null;
};

/** A top-level comment as kept in the artifact (spec 221); untrusted text. */
export type CaptureComment = {
  author: string | null;
  text: string;
  likes: number | null;
  publishedAt: string | null;
};

/** Non-fatal problems of a capture that still published (spec 221). */
export type CaptureWarning =
  | 'speech_not_transcribed'
  | 'frames_unavailable'
  | 'images_not_described';

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
  /** Thumbnails and post images (never video keyframes). */
  images: CaptureImageRef[];
  hasVideo?: boolean;
  /** Video keyframes: from the upload extraction or from `/v1/frames`. */
  frames?: CaptureImageRef[];
  /** Set once `/v1/frames` answered, so a retry does not download again. */
  framesFetched?: boolean;
  comments?: CaptureComment[];
  extractor: string | null;
  upload?: { objectKey: string; filename: string; mimeType: string } | null;
  stt?: { model: string; costUsd: number | null; language: string | null } | null;
  imageDescriptions?: Array<{ index: number; description: string }>;
  frameDescriptions?: Array<{ timeSec: number | null; description: string }>;
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
