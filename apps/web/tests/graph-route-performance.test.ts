import { describe, expect, test } from 'bun:test';
import { isGraphSnapshotIndexing, shouldScheduleGraphReindex } from '../src/lib/graph-index-state';

describe('shouldScheduleGraphReindex', () => {
  test('does nothing when indexed coverage is current', () => {
    expect(
      shouldScheduleGraphReindex({
        force: false,
        expectedSourceNodes: 20,
        indexedSourceNodes: 20,
        staleSourceNodes: 0,
      }),
    ).toBe(false);
  });

  test('schedules background work for missing, stale, or explicitly forced coverage', () => {
    expect(
      shouldScheduleGraphReindex({
        force: false,
        expectedSourceNodes: 20,
        indexedSourceNodes: 19,
        staleSourceNodes: 0,
      }),
    ).toBe(true);
    expect(
      shouldScheduleGraphReindex({
        force: false,
        expectedSourceNodes: 20,
        indexedSourceNodes: 20,
        staleSourceNodes: 1,
      }),
    ).toBe(true);
    expect(
      shouldScheduleGraphReindex({
        force: true,
        expectedSourceNodes: 20,
        indexedSourceNodes: 20,
        staleSourceNodes: 0,
      }),
    ).toBe(true);
  });

  test('does not schedule an empty library even when refresh is forced', () => {
    expect(
      shouldScheduleGraphReindex({
        force: true,
        expectedSourceNodes: 0,
        indexedSourceNodes: 0,
        staleSourceNodes: 0,
      }),
    ).toBe(false);
  });
});

describe('isGraphSnapshotIndexing', () => {
  test('keeps polling and cache disabled when reindex finishes during snapshot reads', () => {
    expect(isGraphSnapshotIndexing(true, false)).toBe(true);
  });

  test('reports current in-flight work and releases a stable snapshot', () => {
    expect(isGraphSnapshotIndexing(false, true)).toBe(true);
    expect(isGraphSnapshotIndexing(false, false)).toBe(false);
  });
});
