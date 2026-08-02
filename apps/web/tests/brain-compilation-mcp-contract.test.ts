import { expect, test } from 'bun:test';

const source = await Bun.file(new URL('../src/routes/mcp.ts', import.meta.url)).text();

test('MCP expõe cobertura e localização da compilação grounded', () => {
  expect(source).toContain("'voxen_brain_compilation_status'");
  expect(source).toContain('totalSegments: true');
  expect(source).toContain('completedSegments: true');
  expect(source).toContain('startLine: true');
  expect(source).toContain('endLine: true');
});
