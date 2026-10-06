import { expect, test } from 'bun:test';
import { resolveMcpRequestOrigin } from '../src/routes/mcp-origin-boundary';

const canonical = 'https://voxen.example.test';
test('canonical MCP origin accepts TLS termination without trusting forwarding headers', () => {
  expect(
    resolveMcpRequestOrigin(
      new Request('http://voxen.example.test/mcp', { headers: { origin: canonical } }),
      canonical,
      true,
    ),
  ).toBe(canonical);
  expect(
    resolveMcpRequestOrigin(new Request('http://voxen.example.test/mcp'), canonical, true),
  ).toBe(canonical);
});

test('invalid configuration and foreign origins/hosts fail closed', () => {
  for (const config of [
    'invalid',
    'ftp://voxen.example.test',
    'https://user:password@voxen.example.test',
  ]) {
    expect(resolveMcpRequestOrigin(new Request(canonical + '/mcp'), config, true)).toBeNull();
  }
  const invalidHeaders: Record<string, string>[] = [
    { origin: 'https://evil.example.test' },
    { origin: 'null' },
    { host: 'evil.example.test', 'x-forwarded-host': 'voxen.example.test' },
    { origin: canonical + '/private' },
  ];
  for (const headers of invalidHeaders) {
    expect(
      resolveMcpRequestOrigin(new Request(canonical + '/mcp', { headers }), canonical, true),
    ).toBeNull();
  }
  expect(
    resolveMcpRequestOrigin(
      new Request('http://evil.example.test/mcp', {
        headers: { 'x-forwarded-host': 'voxen.example.test' },
      }),
      canonical,
      true,
    ),
  ).toBeNull();
});

test('absent configuration only permits a matching loopback development boundary', () => {
  for (const origin of ['http://localhost', 'http://127.0.0.1:3111', 'http://[::1]:4000']) {
    expect(
      resolveMcpRequestOrigin(
        new Request(origin + '/mcp', { headers: { origin } }),
        undefined,
        false,
      ),
    ).toBe(origin);
    expect(
      resolveMcpRequestOrigin(
        new Request(origin + '/mcp', { headers: { origin: 'https://evil.example.test' } }),
        undefined,
        false,
      ),
    ).toBeNull();
    expect(resolveMcpRequestOrigin(new Request(origin + '/mcp'), undefined, true)).toBeNull();
  }
  expect(
    resolveMcpRequestOrigin(
      new Request('http://localhost:3111/mcp', { headers: { origin: 'http://localhost:3000' } }),
      undefined,
      false,
    ),
  ).toBeNull();
  expect(
    resolveMcpRequestOrigin(new Request('http://192.168.1.10/mcp'), undefined, false),
  ).toBeNull();
});
