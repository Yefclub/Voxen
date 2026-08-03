import assert from 'node:assert/strict';
import test from 'node:test';

import {
  patchArguments,
  repositorySettingsDiff,
} from './github-repository-settings.mjs';

test('repository settings diff reports only drifted managed fields', () => {
  assert.deepEqual(
    repositorySettingsDiff(
      { description: 'English', allow_squash_merge: true },
      { description: 'Português', allow_squash_merge: true, private: true },
    ),
    [{ key: 'description', expected: 'English', actual: 'Português' }],
  );
});

test('repository settings patch preserves booleans as typed fields', () => {
  const previous = process.env.GITHUB_REPOSITORY;
  process.env.GITHUB_REPOSITORY = 'Yefclub/Voxen';
  try {
    assert.deepEqual(
      patchArguments({ description: 'English', allow_squash_merge: true }),
      [
        'api',
        '--method',
        'PATCH',
        'repos/Yefclub/Voxen',
        '-f',
        'description=English',
        '-F',
        'allow_squash_merge=true',
      ],
    );
  } finally {
    if (previous === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = previous;
  }
});
