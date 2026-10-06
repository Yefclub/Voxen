import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { createServer, request as httpsRequest, type RequestOptions } from 'node:https';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchMcpClientMetadata, metadataNetwork } from '../src/lib/mcp-metadata-transport';
import { validateMcpOAuthRedirect } from '../src/lib/mcp-oauth-redirect';

const restores: Array<() => void> = [];
afterEach(() => {
  for (const restore of restores.splice(0)) restore();
});
function dns(addresses = ['8.8.8.8']) {
  const mock = spyOn(metadataNetwork, 'lookup').mockResolvedValue(
    addresses.map((address) => ({ address, family: 4 })) as never,
  );
  restores.push(() => mock.mockRestore());
  return mock;
}
function wire(body = '{}', status = 200, headers: Record<string, string> = {}) {
  let options: RequestOptions = {},
    connection!: ClientRequest;
  const mock = spyOn(metadataNetwork, 'request').mockImplementation((_url, opts, callback) => {
    options = opts as RequestOptions;
    connection = new EventEmitter() as ClientRequest;
    connection.destroy = () => connection;
    connection.end = (() => {
      queueMicrotask(() => {
        const stream = new PassThrough();
        const response = stream as unknown as IncomingMessage;
        response.statusCode = status;
        response.headers = headers;
        (callback as (response: IncomingMessage) => void)(response);
        stream.end(body);
      });
      return connection;
    }) as ClientRequest['end'];
    return connection;
  });
  restores.push(() => mock.mockRestore());
  return { mock, options: () => options, connection: () => connection };
}

describe('bounded metadata network boundary', () => {
  test.each([
    'http://example.test/client.json',
    'https://user:secret@example.test/client.json',
    'https://example.test/client.json#fragment',
  ])('rejects invalid URL %s before DNS', async (url) => {
    const lookup = dns();
    await expect(fetchMcpClientMetadata(url)).rejects.toBeDefined();
    expect(lookup).not.toHaveBeenCalled();
  });
  test.each([
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '192.0.2.1',
    '::1',
    'fc00::1',
    '::ffff:127.0.0.1',
  ])('rejects every special-use answer including mixed DNS: %s', async (address) => {
    dns(['8.8.8.8', address]);
    const network = wire();
    await expect(fetchMcpClientMetadata('https://metadata.example/client.json')).rejects.toThrow(
      'public routable',
    );
    expect(network.mock).not.toHaveBeenCalled();
  });
  test('resolves once and pins both lookup callback forms while retaining original host and TLS name', async () => {
    const lookup = dns();
    const network = wire('{"client_name":"QA"}');
    const response = await fetchMcpClientMetadata('https://metadata.example/client.json');
    expect(await response.json()).toEqual({ client_name: 'QA' });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(network.options().servername).toBe('metadata.example');
    expect(network.options().headers).toMatchObject({ host: 'metadata.example' });
    const callback = network.options().lookup! as (...args: unknown[]) => void;
    let selected: unknown;
    callback('metadata.example', { all: true }, (_error: unknown, value: unknown) => {
      selected = value;
    });
    expect(selected).toEqual([{ address: '8.8.8.8', family: 4 }]);
    callback(
      'metadata.example',
      { all: false },
      (_error: unknown, address: unknown, family: unknown) => {
        selected = { address, family };
      },
    );
    expect(selected).toEqual({ address: '8.8.8.8', family: 4 });
    // Repeated errors remain handled after the promise settles, including Bun's destruction path.
    expect(network.connection().emit('error', new Error('first'))).toBe(true);
    expect(network.connection().emit('error', new Error('second'))).toBe(true);
  });
  test.each([600, 999])(
    'rejects invalid HTTP status %s without an event-listener exception',
    async (status) => {
      dns();
      wire('{}', status);
      await expect(fetchMcpClientMetadata('https://metadata.example/client.json')).rejects.toThrow(
        'Invalid metadata response status',
      );
    },
  );
  test('refuses redirects and oversized declared or streamed responses', async () => {
    const fixtures: Array<{ body: string; status: number; headers: Record<string, string> }> = [
      { body: '{}', status: 302, headers: { location: 'https://other.example/' } },
      { body: '{}', status: 200, headers: { 'content-length': '200000' } },
      { body: 'x'.repeat(131073), status: 200, headers: {} },
    ];
    for (const fixture of fixtures) {
      dns();
      wire(fixture.body, fixture.status, fixture.headers);
      await expect(
        fetchMcpClientMetadata('https://metadata.example/client.json'),
      ).rejects.toBeDefined();
      for (const restore of restores.splice(0)) restore();
    }
  });
  test('bounds a DNS resolver which never returns and avoids any connection', async () => {
    const lookup = spyOn(metadataNetwork, 'lookup').mockImplementation(() => new Promise(() => {}));
    restores.push(() => lookup.mockRestore());
    const network = wire();
    await expect(
      fetchMcpClientMetadata('https://metadata.example/client.json', {
        signal: AbortSignal.timeout(20),
      }),
    ).rejects.toThrow('deadline');
    expect(network.mock).not.toHaveBeenCalled();
  });
  test('permits conditional 304 and HEAD without a response body', async () => {
    dns();
    wire('', 304);
    const response = await fetchMcpClientMetadata('https://metadata.example/client.json');
    expect(response.status).toBe(304);
    expect(await response.text()).toBe('');
  });
});

describe('strict native callback matching', () => {
  test('allows only a changed port on the same registered loopback host, path and query', () => {
    const registered = ['http://127.0.0.1:3000/auth/callback?client=voxen'];
    expect(
      validateMcpOAuthRedirect('http://127.0.0.1:49152/auth/callback?client=voxen', registered),
    ).toBe(true);
    for (const value of [
      'http://localhost:49152/auth/callback?client=voxen',
      'http://127.0.0.1:49152/other?client=voxen',
      'http://127.0.0.1:49152/auth/callback?client=other',
      'https://evil.example/callback',
      'http://127.0.0.1:49152/auth/callback?client=voxen#secret',
    ])
      expect(validateMcpOAuthRedirect(value, registered)).toBe(false);
    expect(
      validateMcpOAuthRedirect('https://client.example/callback', [
        'https://client.example/callback',
      ]),
    ).toBe(true);
  });
});

describe('metadata TLS identity with real sockets', () => {
  test('accepts a trusted certificate only for the original metadata hostname', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'voxen-metadata-tls-'));
    try {
      for (const hostname of ['metadata.example', 'wrong.example']) {
        const keyPath = join(directory, hostname + '.key');
        const certPath = join(directory, hostname + '.crt');
        const result = Bun.spawnSync([
          'openssl',
          'req',
          '-x509',
          '-newkey',
          'ec',
          '-pkeyopt',
          'ec_paramgen_curve:P-256',
          '-nodes',
          '-days',
          '1',
          '-subj',
          '/CN=' + hostname,
          '-addext',
          'subjectAltName=DNS:' + hostname,
          '-keyout',
          keyPath,
          '-out',
          certPath,
        ]);
        expect(result.exitCode).toBe(0);
        const cert = await readFile(certPath);
        let requests = 0;
        const server = createServer(
          { key: await readFile(keyPath), cert },
          (_request, response) => {
            requests++;
            response.end('{"client_name":"TLS fixture"}');
          },
        );
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Missing TLS fixture address');
        dns();
        // Route to a local fixture and trust its issuer, retaining production
        // servername and normal TLS verification. DNS pinning is tested separately.
        let tlsError = '';
        const network = spyOn(metadataNetwork, 'request').mockImplementation(
          (url, options, callback) => {
            const connection = httpsRequest(
              new URL(`https://127.0.0.1:${address.port}${url.pathname}`),
              {
                ...options,
                port: address.port,
                ca: cert,
                lookup: (_host, opts, cb) => {
                  if (typeof opts === 'object' && opts.all)
                    cb(null, [{ address: '127.0.0.1', family: 4 }]);
                  else cb(null, '127.0.0.1', 4);
                },
              },
              callback,
            );
            connection.on('error', (error) => {
              tlsError = error.message;
            });
            return connection;
          },
        );
        try {
          if (hostname === 'metadata.example') {
            const response = await fetchMcpClientMetadata('https://metadata.example/client.json');
            expect(await response.json()).toEqual({ client_name: 'TLS fixture' });
            expect(requests).toBe(1);
          } else {
            await expect(
              fetchMcpClientMetadata('https://metadata.example/client.json'),
            ).rejects.toBeDefined();
            expect(requests).toBe(0);
            expect(tlsError).toContain('ERR_TLS_CERT_ALTNAME_INVALID');
          }
        } finally {
          network.mockRestore();
          for (const restore of restores.splice(0)) restore();
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 10000);
});
