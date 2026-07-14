import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  healStaleRunningInSegments,
  healStaleRunningTools,
  isToolErrorOutput,
  type ToolEventLike,
} from '../src/lib/chat/tool-outcomes';

const runtimeSource = readFileSync(join(import.meta.dir, '../src/lib/chat/runtime.ts'), 'utf8');

describe('isToolErrorOutput', () => {
  test('detects outcome error and error string', () => {
    expect(isToolErrorOutput({ outcome: 'error', error: 'falhou' })).toBe(true);
    expect(isToolErrorOutput({ error: 'Job não encontrado.' })).toBe(true);
    expect(isToolErrorOutput({ error: '   ' })).toBe(false);
    expect(isToolErrorOutput({ error: null })).toBe(false);
    expect(isToolErrorOutput({ results: [] })).toBe(false);
  });
});

describe('healStaleRunningTools', () => {
  test('converts running tools to error', () => {
    const input: ToolEventLike[] = [
      { id: '1', name: 'request_transcription', state: 'running' },
      { id: '2', name: 'search_transcripts', state: 'completed', output: { results: [] } },
    ];
    const { tools, changed } = healStaleRunningTools(input);
    expect(changed).toBe(true);
    expect(tools[0]?.state).toBe('error');
    expect(isToolErrorOutput(tools[0]?.output)).toBe(true);
    expect(tools[1]?.state).toBe('completed');
  });

  test('is a no-op when nothing is running', () => {
    const input: ToolEventLike[] = [
      { id: '1', name: 'search_transcripts', state: 'error', output: { error: 'x' } },
    ];
    const { changed } = healStaleRunningTools(input);
    expect(changed).toBe(false);
  });
});

describe('healStaleRunningInSegments', () => {
  test('heals tools inside tool-group segments', () => {
    const tools: ToolEventLike[] = [
      { id: 't1', name: 'request_transcription', state: 'running' },
    ];
    const { segments, changed } = healStaleRunningInSegments([
      { type: 'reasoning' as const },
      { type: 'tool-group' as const, tools },
    ]);
    expect(changed).toBe(true);
    const group = segments[1];
    expect(group?.type).toBe('tool-group');
    if (group?.type !== 'tool-group') return;
    expect(group.tools[0]?.state).toEqual('error' as ToolEventLike['state']);
  });
});

describe('chat runtime wiring for tool failures', () => {
  test('uses library status copy and heals running tools before persist', () => {
    expect(runtimeSource).toContain("label: 'Buscando na sua biblioteca…'");
    expect(runtimeSource).not.toContain('Consultando seu acervo');
    expect(runtimeSource).toContain('healStaleRunningTools(tools)');
    expect(runtimeSource).toContain('isToolErrorOutput(output)');
  });

  test('request_transcription returns structured errors instead of throwing', () => {
    expect(runtimeSource).toContain("return { outcome: 'error' as const, error: message }");
  });
});
