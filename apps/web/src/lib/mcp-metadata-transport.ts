import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { request, type RequestOptions } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import { isPublicRoutableHost } from '@better-auth/core/utils/host';
import type { ClientMetadataResourceFetch } from '@better-auth/oauth-provider';

export const metadataNetwork = {
  lookup: (hostname: string) => lookup(hostname, { all: true, verbatim: true }),
  request: (url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) =>
    request(url, options, callback),
};
const MAX_BYTES = 128 * 1024;

/** Resolve once, pin the approved address, retain TLS identity, and bound the entire exchange. */
export const fetchMcpClientMetadata: ClientMetadataResourceFetch = async (input, init) => {
  const original = new Request(input, init);
  const url = new URL(original.url);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    url.href.length > 2048
  )
    throw new TypeError('Invalid metadata HTTPS URL');
  if (!['GET', 'HEAD'].includes(original.method)) throw new TypeError('Invalid metadata method');
  const signal = AbortSignal.any([original.signal, AbortSignal.timeout(5000)]);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = await new Promise<LookupAddress[]>((resolve, reject) => {
    const aborted = () => reject(new TypeError('Metadata deadline exceeded'));
    if (signal.aborted) return aborted();
    signal.addEventListener('abort', aborted, { once: true });
    metadataNetwork
      .lookup(hostname)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', aborted));
  });
  if (
    !Array.isArray(addresses) ||
    !addresses.length ||
    addresses.some((entry) => !isPublicRoutableHost(entry.address))
  )
    throw new TypeError('Metadata requires public routable addresses');
  const pinned = addresses[0]!;
  let cleanupSignal = () => {};
  return new Promise<Response>((resolve, reject) => {
    const connection = metadataNetwork.request(
      url,
      {
        agent: false,
        method: original.method,
        signal,
        maxHeaderSize: 16384,
        headers: {
          ...Object.fromEntries(original.headers),
          host: url.host,
          'accept-encoding': 'identity',
        },
        servername: isIP(hostname) ? undefined : hostname,
        lookup: (_host, options, callback) => {
          if (typeof options === 'object' && options.all) callback(null, [pinned]);
          else callback(null, pinned.address, pinned.family);
        },
      },
      (response) => {
        const status = response.statusCode ?? 500;
        if (!Number.isInteger(status) || status < 200 || status > 599) {
          response.destroy();
          connection.destroy();
          reject(new TypeError('Invalid metadata response status'));
          return;
        }
        // 304 is a conditional metadata response, not a redirect.
        if (status >= 300 && status < 400 && status !== 304) {
          response.destroy();
          connection.destroy();
          reject(new TypeError('Metadata redirects are forbidden'));
          return;
        }
        const length = Number(response.headers['content-length'] ?? 0);
        if (length > MAX_BYTES) {
          response.destroy();
          connection.destroy();
          reject(new TypeError('Metadata body too large'));
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.byteLength;
          if (bytes > MAX_BYTES) {
            response.destroy();
            connection.destroy();
            reject(new TypeError('Metadata body too large'));
          } else chunks.push(chunk);
        });
        response.on('error', () => reject(new TypeError('Metadata response failed')));
        response.on('aborted', () => reject(new TypeError('Metadata response interrupted')));
        response.on('end', () => {
          try {
            const headers = new Headers();
            for (const [key, value] of Object.entries(response.headers)) {
              if (Array.isArray(value)) for (const item of value) headers.append(key, item);
              else if (value !== undefined) headers.set(key, value);
            }
            resolve(
              new Response(
                original.method === 'HEAD' || [204, 205, 304].includes(status)
                  ? null
                  : Buffer.concat(chunks),
                { status, headers },
              ),
            );
          } catch {
            reject(new TypeError('Invalid metadata response'));
          }
        });
      },
    );
    // Keep this listener through destruction: Bun can report more than one connection error.
    connection.on('error', () => reject(new TypeError('Metadata connection failed')));
    const aborted = () => {
      connection.destroy();
      reject(new TypeError('Metadata deadline exceeded'));
    };
    signal.addEventListener('abort', aborted, { once: true });
    cleanupSignal = () => signal.removeEventListener('abort', aborted);
    // The total deadline also covers a socket that closes without a response.
    // Bun may emit request.close before incoming response events finish.
    if (signal.aborted) aborted();
    connection.end();
  }).finally(() => cleanupSignal());
};
