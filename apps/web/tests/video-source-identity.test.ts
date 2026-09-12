import { describe, expect, it } from 'bun:test';
import { resolveVideoSourceIdentity } from '../src/lib/video-source-identity';
import { parseVideoUrl } from '../src/lib/video-url';

function video(url: string) {
  const parsed = parseVideoUrl(url);
  if (!parsed) throw new Error(`Invalid test URL: ${url}`);
  return parsed;
}

describe('resolveVideoSourceIdentity', () => {
  it('resolve uma cadeia oficial do TikTok até a URL canônica', async () => {
    const visited: string[] = [];
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      const url = input.toString();
      visited.push(url);
      if (url === 'https://vt.tiktok.com/ZSVJHUMAG') {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://m.tiktok.com/t/ZSVJHUMAG/' },
        });
      }
      if (url === 'https://m.tiktok.com/t/ZSVJHUMAG/') {
        return new Response(null, {
          status: 301,
          headers: {
            location: 'https://www.tiktok.com/@renatoasse/video/7672827813124164872?share=1',
          },
        });
      }
      return new Response(null, { status: 200 });
    };

    await expect(
      resolveVideoSourceIdentity(video('https://vt.tiktok.com/ZSVJHUMAG'), fetchImpl),
    ).resolves.toBe('https://www.tiktok.com/@renatoasse/video/7672827813124164872');
    expect(visited).toEqual([
      'https://vt.tiktok.com/ZSVJHUMAG',
      'https://m.tiktok.com/t/ZSVJHUMAG/',
      'https://www.tiktok.com/@renatoasse/video/7672827813124164872?share=1',
    ]);
  });

  it('recusa redirects para hosts externos ou portas não padrão', async () => {
    const short = video('https://vm.tiktok.com/ZMabCdEf');
    for (const location of ['https://example.com/video', 'https://www.tiktok.com:8443/video/1']) {
      const fetchImpl = async () => new Response(null, { status: 302, headers: { location } });
      await expect(resolveVideoSourceIdentity(short, fetchImpl)).resolves.toBe(short.canonical);
    }
  });

  it('mantém a URL original quando a resolução falha', async () => {
    const short = video('https://vt.tiktok.com/XyZ123');
    const fetchImpl = async (): Promise<Response> => {
      throw new Error('network failure with provider payload');
    };
    await expect(resolveVideoSourceIdentity(short, fetchImpl)).resolves.toBe(short.canonical);
  });

  it('não faz chamada de rede para URLs que já são canônicas', async () => {
    let calls = 0;
    const canonical = video('https://www.tiktok.com/@someuser/video/7123456789012345678');
    const fetchImpl = async () => {
      calls += 1;
      return new Response(null, { status: 200 });
    };
    await expect(resolveVideoSourceIdentity(canonical, fetchImpl)).resolves.toBe(
      canonical.canonical,
    );
    expect(calls).toBe(0);
  });
});
