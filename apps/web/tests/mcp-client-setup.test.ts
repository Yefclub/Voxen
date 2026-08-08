import { describe, expect, it } from 'bun:test';
import { mcpClientSetups, mcpTokenPlaceholder } from '../src/client/lib/mcp-client-setup';

const ENDPOINT = 'https://voxen.example/mcp';

describe('MCP client setup', () => {
  it('keeps English and PT-BR client coverage and support status aligned', () => {
    const en = mcpClientSetups('en', ENDPOINT);
    const ptBr = mcpClientSetups('pt-BR', ENDPOINT);

    expect(ptBr.map(({ id, status }) => ({ id, status }))).toEqual(
      en.map(({ id, status }) => ({ id, status })),
    );
    expect(en.map((setup) => setup.id)).toEqual([
      'codex',
      'claude',
      'openai',
      'anthropic',
      'cursor',
      'inspector',
      'grok',
    ]);
  });

  it('never persists a visible one-time token in generated configurations', () => {
    const placeholder = mcpTokenPlaceholder();
    const setups = mcpClientSetups('en', ENDPOINT);

    expect(setups.some((setup) => setup.config.includes(placeholder))).toBe(true);
    expect(setups.every((setup) => !setup.config.includes('one-time-test-token'))).toBe(true);
    expect(setups.find((setup) => setup.id === 'claude')?.config).toContain('VOXEN_MCP_TOKEN');
  });

  it('does not present a personal token as Grok OAuth credentials', () => {
    const grok = mcpClientSetups('pt-BR', ENDPOINT).find((setup) => setup.id === 'grok');

    expect(grok?.status).toBe('unsupported');
    expect(grok?.config).not.toContain('one-time-test-token');
    expect(grok?.summary).toContain('OAuth');
  });
});

describe('MCP documentation contract', () => {
  it('links both guides and preserves localized client parity', async () => {
    const [root, index, enIndex, enGuide, ptBrGuide] = await Promise.all([
      Bun.file(new URL('../../../README.md', import.meta.url)).text(),
      Bun.file(new URL('../../../docs/README.md', import.meta.url)).text(),
      Bun.file(new URL('../../../docs/en/README.md', import.meta.url)).text(),
      Bun.file(new URL('../../../docs/en/MCP.md', import.meta.url)).text(),
      Bun.file(new URL('../../../docs/MCP.md', import.meta.url)).text(),
    ]);

    expect(root).toContain('docs/en/MCP.md');
    expect(index).toContain('en/MCP.md');
    expect(index).toContain('MCP.md');
    expect(enIndex).toContain('MCP.md');
    for (const client of ['Codex', 'Claude Code', 'OpenAI', 'Anthropic', 'Cursor', 'Grok']) {
      expect(enGuide).toContain(client);
      expect(ptBrGuide).toContain(client);
    }
    expect(enGuide).toContain('YOUR_VOXEN_MCP_TOKEN');
    expect(ptBrGuide).toContain('SEU_TOKEN_MCP_VOXEN');
    expect(`${enGuide}\n${ptBrGuide}`).not.toMatch(/vxn_mcp_[A-Za-z0-9_-]{16,}/);
  });

  it('mounts the client setup card on the user-owned MCP page', async () => {
    const page = await Bun.file(
      new URL('../src/client/pages/conta-mcp.tsx', import.meta.url),
    ).text();
    const card = await Bun.file(
      new URL('../src/client/components/account/mcp-client-setup.tsx', import.meta.url),
    ).text();

    expect(page).toContain('<McpClientSetup');
    expect(page).toContain('visibleToken={secret}');
    expect(card).toContain("setup.status === 'unsupported'");
    expect(card).toContain('target="_blank"');
  });
});
