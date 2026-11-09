// ============================================================================
// Capture URL validation and canonical identity (spec 220)
// ============================================================================
// The web process never fetches a submitted URL: the capture worker does,
// behind its egress proxy. This module only rejects URLs that are obviously
// unsafe or malformed at submit time and derives a stable identity for
// deduplication. Hostnames that resolve to private ranges are caught later by
// the worker's proxy (`BLOCKED_ADDRESS` as a job failure).
// ============================================================================

import { isIP } from 'node:net';
import { parseVideoUrl, type VideoSource } from '../video-url';

export const MAX_CAPTURE_URL_LENGTH = 2048;

export type CapturePlatform = VideoSource | 'WEB';

export type CaptureUrl = {
  /** URL to hand to the worker (trimmed, fragment removed). */
  url: string;
  /** Stable identity used for dedupe and stored as the document URL. */
  canonical: string;
  platform: CapturePlatform;
  platformId: string | null;
};

export type CaptureUrlError = { code: 'INVALID_URL' | 'BLOCKED_ADDRESS' };

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa'];
const BLOCKED_HOSTS = new Set(['localhost', 'metadata.google.internal', 'metadata']);

const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'msclkid',
  'igsh',
  'igshid',
  'mc_cid',
  'mc_eid',
  'ref_src',
  'ref_url',
  'si',
  'feature',
  '_hsenc',
  '_hsmi',
  'yclid',
]);

/** Parses an IPv4 literal in any form WHATWG URL accepts and returns its octets. */
function ipv4Octets(host: string): number[] | null {
  if (isIP(host) !== 4) return null;
  return host.split('.').map((part) => Number(part));
}

function isBlockedIpv4(octets: number[]): boolean {
  const [a = 0, b = 0] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isBlockedIpv6(host: string): boolean {
  const h = host.toLowerCase();
  if (h === '::' || h === '::1') return true;
  // IPv4-mapped / -compatible forms (::ffff:a.b.c.d, ::ffff:7f00:1, ::a.b.c.d).
  const mapped = /^::(?:ffff:)?(.+)$/.exec(h);
  if (mapped?.[1]) {
    const tail = mapped[1];
    const dotted = ipv4Octets(tail);
    if (dotted) return isBlockedIpv4(dotted);
    const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(tail);
    if (hex?.[1] && hex[2]) {
      const hi = parseInt(hex[1], 16);
      const lo = parseInt(hex[2], 16);
      return isBlockedIpv4([hi >> 8, hi & 0xff, lo >> 8, lo & 0xff]);
    }
  }
  return (
    h.startsWith('fc') ||
    h.startsWith('fd') ||
    h.startsWith('fe8') ||
    h.startsWith('fe9') ||
    h.startsWith('fea') ||
    h.startsWith('feb') ||
    h.startsWith('ff') ||
    h.startsWith('64:ff9b:') ||
    h.startsWith('2001:db8:')
  );
}

/** True when the hostname is a literal or reserved name that must never be fetched. */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[') && host.endsWith(']')) return isBlockedIpv6(host.slice(1, -1));
  if (isIP(host) === 6) return isBlockedIpv6(host);
  const octets = ipv4Octets(host);
  if (octets) return isBlockedIpv4(octets);
  if (BLOCKED_HOSTS.has(host)) return true;
  if (!host.includes('.')) return true;
  return BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

function normalizeWebUrl(url: URL): string {
  const out = new URL(url.toString());
  out.hash = '';
  out.hostname = out.hostname.toLowerCase();
  if (
    (out.protocol === 'https:' && out.port === '443') ||
    (out.protocol === 'http:' && out.port === '80')
  ) {
    out.port = '';
  }
  const kept = [...out.searchParams.entries()]
    .filter(
      ([key]) => !key.toLowerCase().startsWith('utm_') && !TRACKING_PARAMS.has(key.toLowerCase()),
    )
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  out.search = '';
  for (const [key, value] of kept) out.searchParams.append(key, value);
  return out.toString();
}

/** Validates a submitted URL and derives its canonical capture identity. */
export function parseCaptureUrl(input: unknown): CaptureUrl | CaptureUrlError {
  if (typeof input !== 'string') return { code: 'INVALID_URL' };
  const raw = input.trim();
  if (raw.length === 0 || raw.length > MAX_CAPTURE_URL_LENGTH) return { code: 'INVALID_URL' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { code: 'INVALID_URL' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { code: 'INVALID_URL' };
  if (url.username || url.password) return { code: 'INVALID_URL' };
  if (!url.hostname) return { code: 'INVALID_URL' };
  if (isBlockedHost(url.hostname)) return { code: 'BLOCKED_ADDRESS' };
  if (url.port && url.port !== '80' && url.port !== '443') return { code: 'BLOCKED_ADDRESS' };

  url.hash = '';
  const video = parseVideoUrl(url.toString());
  if (video) {
    return {
      url: url.toString(),
      canonical: video.canonical,
      platform: video.source,
      platformId: video.videoId,
    };
  }
  return {
    url: url.toString(),
    canonical: normalizeWebUrl(url),
    platform: 'WEB',
    platformId: null,
  };
}

export function isCaptureUrlError(value: CaptureUrl | CaptureUrlError): value is CaptureUrlError {
  return 'code' in value;
}
