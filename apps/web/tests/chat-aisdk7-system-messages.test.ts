import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const runtimeSource = readFileSync(join(import.meta.dir, '../src/lib/chat/runtime.ts'), 'utf8');

describe('AI SDK 7 system message handling in chat runtime', () => {
  test('streamText opts into trusted SYSTEM history via allowSystemInMessages', () => {
    expect(runtimeSource).toContain('allowSystemInMessages: true');
    expect(runtimeSource).toContain('messages: toModelMessages(active)');
  });

  test('compaction generateText uses instructions instead of deprecated system', () => {
    const compactionBlock = runtimeSource.slice(
      runtimeSource.indexOf('async function maybeCompact'),
      runtimeSource.indexOf('export async function streamAssistantReply'),
    );
    expect(compactionBlock).toContain('instructions:');
    expect(compactionBlock).not.toMatch(/generateText\(\{[\s\S]*?\bsystem:/);
  });

  test('toModelMessages still maps DB SYSTEM role for trusted server rows', () => {
    expect(runtimeSource).toContain(
      "role: message.role === 'USER' ? 'user' : message.role === 'ASSISTANT' ? 'assistant' : 'system'",
    );
  });
});
