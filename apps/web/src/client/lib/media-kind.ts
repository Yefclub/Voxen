export type UploadMediaKind = 'video' | 'audio' | 'image' | 'other';

/**
 * Decide qual player/visualizador usar para um upload, a partir do MIME do
 * arquivo original. Puro e testável — a UI (media-viewer) só faz o switch.
 */
export function uploadMediaKind(mimeType: string): UploadMediaKind {
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('image/')) return 'image';
  return 'other';
}
