import { describe, expect, it } from 'bun:test';
import {
  acquireUserMemoryShadowDeletionFence,
  scheduleUserMemoryShadowWrite,
} from './memory-shadow-coordinator';

describe('memory shadow deletion coordination', () => {
  it('drains prior writes and rejects later writes until canonical deletion releases the fence', async () => {
    const events: string[] = [];
    let finishWrite = () => {};
    const writeCanFinish = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    expect(
      scheduleUserMemoryShadowWrite('race-user', async () => {
        events.push('write-started');
        await writeCanFinish;
        events.push('write-finished');
      }),
    ).toBe(true);
    await Promise.resolve();

    const fencePromise = acquireUserMemoryShadowDeletionFence('race-user', async () => {
      events.push('remote-deleted');
    });
    expect(scheduleUserMemoryShadowWrite('race-user', async () => {})).toBe(false);
    expect(events).toEqual(['write-started']);

    finishWrite();
    const release = await fencePromise;
    expect(events).toEqual(['write-started', 'write-finished', 'remote-deleted']);
    expect(scheduleUserMemoryShadowWrite('race-user', async () => {})).toBe(false);
    release();
    expect(scheduleUserMemoryShadowWrite('race-user', async () => {})).toBe(true);
  });

  it('releases the fence when remote deletion fails', async () => {
    await expect(
      acquireUserMemoryShadowDeletionFence('failed-delete-user', async () => {
        throw new Error('remote unavailable');
      }),
    ).rejects.toThrow('remote unavailable');
    expect(scheduleUserMemoryShadowWrite('failed-delete-user', async () => {})).toBe(true);
  });
});
