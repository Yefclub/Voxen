export function parseSingleByteRange(
  header: string,
  size: number,
): { start: number; end: number } | null {
  if (size <= 0 || header.includes(',')) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const startText = match[1] ?? '';
  const endText = match[2] ?? '';
  if (!startText && !endText) return null;
  if (!startText) {
    const suffix = Number(endText);
    if (!Number.isInteger(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(startText);
  const requestedEnd = endText ? Number(endText) : size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(requestedEnd) || start < 0 || start >= size) {
    return null;
  }
  const end = Math.min(requestedEnd, size - 1);
  return end < start ? null : { start, end };
}

export function buildOriginalResponseInit(opts: {
  rangeHeader?: string;
  storageContentType?: string;
  storageContentLength?: number;
  storageContentRange?: string;
  fallbackMime: string | null;
  filename: string;
}): { status: number; headers: Record<string, string> } {
  const contentType = opts.fallbackMime || opts.storageContentType || 'application/octet-stream';
  const headers: Record<string, string> = {
    'content-type': contentType,
    'cache-control': 'private, max-age=300',
    'content-disposition': `${inlineSafeMime(contentType) ? 'inline' : 'attachment'}; filename="${opts.filename}"`,
    'accept-ranges': 'bytes',
    'x-content-type-options': 'nosniff',
  };
  if (opts.storageContentLength != null) {
    headers['content-length'] = String(opts.storageContentLength);
  }
  if (opts.rangeHeader && opts.storageContentRange) {
    headers['content-range'] = opts.storageContentRange;
    return { status: 206, headers };
  }
  return { status: 200, headers };
}

export function inlineSafeMime(contentType: string): boolean {
  const ct = contentType.toLowerCase().split(';')[0]?.trim() ?? '';
  if (ct.startsWith('video/') || ct.startsWith('audio/')) return true;
  return ct === 'image/png' || ct === 'image/jpeg' || ct === 'image/webp' || ct === 'image/gif';
}
