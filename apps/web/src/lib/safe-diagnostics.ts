const ALLOWED_ERROR_CODES = new Set([
  'JOB_NOTIFY_FAILED',
  'TRANSCRIPT_MARKDOWN_READ_FAILED',
  'TRANSCRIPT_OBJECT_DELETE_FAILED',
  'TRANSCRIPT_ORIGINAL_READ_FAILED',
  'TRANSCRIPT_PREVIEW_READ_FAILED',
  'TRANSCRIPT_SUMMARY_FAILED',
  'TRANSCRIPT_TAG_GENERATION_FAILED',
  'TRANSCRIPT_THUMBNAIL_MIRROR_FAILED',
  'UPLOAD_HEAD_FAILED',
  'UPLOAD_PRESIGN_FAILED',
  'UPLOAD_STORE_FAILED',
]);
const ALLOWED_ERROR_TYPES = new Set([
  'AbortError',
  'AggregateError',
  'Error',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TimeoutError',
  'TypeError',
  'URIError',
]);

export function safeErrorDiagnostic(
  errorCode: string,
  error: unknown,
): { error_code: string; error_type: string } {
  const candidateType = error instanceof Error ? error.name : '';
  return {
    error_code: ALLOWED_ERROR_CODES.has(errorCode) ? errorCode : 'UNEXPECTED_FAILURE',
    error_type: ALLOWED_ERROR_TYPES.has(candidateType) ? candidateType : 'UnknownError',
  };
}
