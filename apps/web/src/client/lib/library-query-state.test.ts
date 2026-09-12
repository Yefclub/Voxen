import { describe, expect, it } from 'bun:test';
import {
  buildLibraryPageItems,
  isCurrentLibraryResponse,
  libraryPageFromParams,
  libraryPageStateFromParams,
  MAX_LIBRARY_PAGE,
  normalizeLibraryRequestQuery,
  updateLibraryParams,
} from './library-query-state';

describe('library URL state', () => {
  it('normalizes invalid and positive page values', () => {
    expect(libraryPageFromParams(new URLSearchParams())).toBe(1);
    expect(libraryPageFromParams(new URLSearchParams('page=0'))).toBe(1);
    expect(libraryPageFromParams(new URLSearchParams('page=-3'))).toBe(1);
    expect(libraryPageFromParams(new URLSearchParams('page=abc'))).toBe(1);
    expect(libraryPageFromParams(new URLSearchParams('page=4'))).toBe(4);
    expect(libraryPageFromParams(new URLSearchParams('page=1000'))).toBe(1000);
    expect(libraryPageFromParams(new URLSearchParams('page=2.9'))).toBe(1);
    expect(libraryPageFromParams(new URLSearchParams(`page=${MAX_LIBRARY_PAGE + 1}`))).toBe(
      MAX_LIBRARY_PAGE,
    );
  });

  it('describes the canonical page parameter for URL replacement', () => {
    expect(libraryPageStateFromParams(new URLSearchParams())).toEqual({
      page: 1,
      canonicalParam: null,
      isCanonical: true,
    });
    for (const raw of ['page=abc', 'page=0', 'page=-3', 'page=1', 'page=0002']) {
      expect(libraryPageStateFromParams(new URLSearchParams(raw)).isCanonical).toBe(false);
    }
    expect(libraryPageStateFromParams(new URLSearchParams('page=0002'))).toMatchObject({
      page: 2,
      canonicalParam: '2',
    });
    expect(
      libraryPageStateFromParams(new URLSearchParams(`page=${MAX_LIBRARY_PAGE + 500}`)),
    ).toEqual({
      page: MAX_LIBRARY_PAGE,
      canonicalParam: String(MAX_LIBRARY_PAGE),
      isCanonical: false,
    });
  });

  it('uses the server query normalization without breaking spaces while typing', () => {
    expect(normalizeLibraryRequestQuery('  graph memory  ')).toBe('graph memory');
    expect(normalizeLibraryRequestQuery('graph ')).toBe('graph');
  });

  it('rejects stale data when any filter changes the requested path', () => {
    const current = {
      resolvedPath: '/api/transcripts?q=graph&status=archived&limit=24&offset=0',
      requestedPath: '/api/transcripts?q=graph&status=archived&limit=24&offset=0',
      responseQuery: 'graph',
      requestedQuery: 'graph',
      responseOffset: 0,
      requestedOffset: 0,
    };
    expect(isCurrentLibraryResponse(current)).toBe(true);
    expect(
      isCurrentLibraryResponse({
        ...current,
        requestedPath: '/api/transcripts?q=graph&status=trash&limit=24&offset=0',
      }),
    ).toBe(false);
  });

  it('resets page while preserving unrelated filters', () => {
    const current = new URLSearchParams(
      'q=graph&page=7&period=this-week&status=archived&folderId=folder-1&tagId=tag-1',
    );

    expect(updateLibraryParams(current, { q: 'agent memory' }).toString()).toBe(
      'q=agent+memory&period=this-week&status=archived&folderId=folder-1&tagId=tag-1',
    );
    expect(updateLibraryParams(current, { folderId: null }).toString()).toBe(
      'q=graph&period=this-week&status=archived&tagId=tag-1',
    );
  });

  it('changes page without discarding active filters', () => {
    const current = new URLSearchParams('q=graph&period=previous-week&tagId=tag-1');
    expect(updateLibraryParams(current, { page: 3 }, { resetPage: false }).toString()).toBe(
      'q=graph&period=previous-week&tagId=tag-1&page=3',
    );
    expect(updateLibraryParams(current, { page: 1 }, { resetPage: false }).toString()).toBe(
      'q=graph&period=previous-week&tagId=tag-1',
    );
  });
});

describe('library numbered pagination', () => {
  it('shows every page for short result sets', () => {
    expect(buildLibraryPageItems(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('keeps boundaries and a window around the current page', () => {
    expect(buildLibraryPageItems(1, 12)).toEqual([1, 2, 3, 4, 5, 'end-gap', 12]);
    expect(buildLibraryPageItems(6, 12)).toEqual([1, 'start-gap', 4, 5, 6, 7, 8, 'end-gap', 12]);
    expect(buildLibraryPageItems(12, 12)).toEqual([1, 'start-gap', 8, 9, 10, 11, 12]);
  });

  it('clamps current and total pages to valid values', () => {
    expect(buildLibraryPageItems(99, 3)).toEqual([1, 2, 3]);
    expect(buildLibraryPageItems(-1, 0)).toEqual([1]);
  });
});
