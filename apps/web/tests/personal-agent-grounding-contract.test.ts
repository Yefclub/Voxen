import { describe, expect, test } from 'bun:test';

const runtimeSource = await Bun.file(new URL('../src/lib/chat/runtime.ts', import.meta.url)).text();
const mcpSource = await Bun.file(new URL('../src/routes/mcp.ts', import.meta.url)).text();
const mcpPersonalContextSource = await Bun.file(
  new URL('../src/routes/mcp-personal-context-tool.ts', import.meta.url),
).text();

describe('shared personal agent grounding contract', () => {
  test('loads personal context in parallel and appends its guarded instructions to chat', () => {
    expect(runtimeSource).toContain(
      'const personalContextPromise = loadPersonalAgentContext(userId)',
    );
    expect(runtimeSource).toContain('personalContextPromise,');
    expect(runtimeSource).toContain('buildPersonalAgentInstructions(personalContext)');
    expect(runtimeSource).toContain('personalInstructions +');
  });

  test('registers personal context only inside the MCP READ surface', () => {
    const readRegistration = mcpSource.indexOf(
      'registerMcpPersonalContextTool(server, userId, publicOrigin)',
    );
    const writeRegistration = mcpSource.indexOf('registerWriteTools(server, userId)');
    const toolRegistration = mcpPersonalContextSource.indexOf("'voxen_personal_context'");

    expect(readRegistration).toBeGreaterThan(0);
    expect(writeRegistration).toBeGreaterThan(readRegistration);
    expect(toolRegistration).toBeGreaterThan(0);
    expect(mcpPersonalContextSource).toContain('withPublicLinks(context, publicOrigin)');
    expect(mcpPersonalContextSource).toContain('enforcePersonalAgentContextBudget(');
  });
});
