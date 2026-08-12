import { describe, expect, it } from 'bun:test';

describe('chat memory shadow integration contract', () => {
  it('records only after the assistant row and completion checks, never before model prompting', async () => {
    const source = await Bun.file(new URL('../chat/runtime.ts', import.meta.url)).text();
    const persistence = await Bun.file(
      new URL('../chat/completed-turn-persistence.ts', import.meta.url),
    ).text();
    const promptIndex = source.indexOf('const result = streamText({');
    const persistIndex = source.indexOf('const assistant = assistantMessageId', promptIndex);
    const shadowIndex = source.indexOf('scheduleCompletedTurnMemoryShadow', persistIndex);
    expect(promptIndex).toBeGreaterThan(-1);
    expect(persistIndex).toBeGreaterThan(promptIndex);
    expect(shadowIndex).toBeGreaterThan(persistIndex);
    const schedulingCall = source.slice(shadowIndex, shadowIndex + 600);
    expect(schedulingCall).toContain('awaitingHitl');
    expect(schedulingCall).toContain('abortSignal.aborted');
    expect(schedulingCall).toContain('failedTools.length === 0');
    expect(schedulingCall).toContain('answer.trim()');
    expect(source.slice(promptIndex, shadowIndex)).toContain("type === 'error'");
    expect(persistence).toContain("kind: 'NORMAL'");
    expect(persistence).toContain("role: 'USER'");
    const canonicalLookup = persistence.indexOf('findFirst');
    expect(canonicalLookup).toBeLessThan(
      persistence.indexOf('recordCompletedTurnInMemoryShadow', canonicalLookup),
    );
    expect(source.slice(promptIndex, persistIndex)).not.toContain('.search({');
  });
});
