import type { TranslateFn } from '../../lib/i18n';

export const MEDIA_ACCEPT =
  'audio/*,video/*,image/png,image/jpeg,image/webp,image/gif,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/markdown,text/csv,text/html,application/json,application/xml,application/epub+zip,.mp3,.wav,.m4a,.aac,.ogg,.opus,.flac,.mp4,.mov,.m4v,.webm,.mkv,.avi,.png,.jpg,.jpeg,.webp,.gif,.pdf,.docx,.pptx,.xls,.xlsx,.csv,.txt,.md,.json,.xml,.html,.htm,.epub';

export function hasFileDrag(types: readonly string[] | DOMStringList | undefined): boolean {
  if (!types) return false;
  for (let i = 0; i < types.length; i++) {
    if (types[i] === 'Files') return true;
  }
  return false;
}

export function shareErrorMessage(errorCode: string, t: TranslateFn): string {
  const key = `jobs.shareError.${errorCode}` as Parameters<TranslateFn>[0];
  const translated = t(key);
  if (translated !== key) return translated;
  return t('jobs.shareError.generic');
}
