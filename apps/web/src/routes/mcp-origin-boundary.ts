function httpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url
      : null;
  } catch {
    return null;
  }
}

/** The direct request host is authoritative; forwarded headers cannot widen trust. */
export function resolveMcpRequestOrigin(
  request: Request,
  configured = process.env.APP_BASE_URL,
  production = process.env.NODE_ENV === 'production',
): string | null {
  const direct = httpUrl(request.url);
  if (!direct) return null;
  const base = configured?.trim();
  const canonical = base ? httpUrl(base) : null;
  if (base && !canonical) return null;
  if (!base && (production || !['localhost', '127.0.0.1', '[::1]'].includes(direct.hostname)))
    return null;
  const allowed = canonical ?? direct;
  if (direct.host !== allowed.host) return null;
  const host = request.headers.get('host');
  if (host && host.toLowerCase() !== allowed.host.toLowerCase()) return null;
  const origin = request.headers.get('origin');
  if (origin && origin !== allowed.origin) return null;
  return allowed.origin;
}
