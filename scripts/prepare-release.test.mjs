import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const projectRoot = new URL('..', import.meta.url).pathname;

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function createReleaseRepository(releases) {
  const root = mkdtempSync(join(tmpdir(), 'voxen-release-'));
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'apps/web'), { recursive: true });
  mkdirSync(join(root, 'changelog'), { recursive: true });

  copyFileSync(
    join(projectRoot, 'scripts/prepare-release.mjs'),
    join(root, 'scripts/prepare-release.mjs'),
  );
  copyFileSync(
    join(projectRoot, 'scripts/release-notes.mjs'),
    join(root, 'scripts/release-notes.mjs'),
  );
  writeJson(join(root, 'package.json'), { version: '1.0.0' });
  writeJson(join(root, 'apps/web/package.json'), { version: '1.0.0' });
  if (typeof releases === 'string') {
    writeFileSync(join(root, 'releases.json'), releases);
  } else {
    writeJson(join(root, 'releases.json'), releases);
  }
  writeFileSync(
    join(root, 'changelog/RELEASE.md'),
    '---\ntipo: feat\ntitulo: Voxen 1.0.1 — busca confiável\n---\n\nA produção agora encontra melhor o conteúdo.\n',
  );

  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], {
    cwd: root,
  });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'initial'], { cwd: root });
  execFileSync('git', ['tag', 'v1.0.0'], { cwd: root });
  return root;
}

function prepare(root) {
  return execFileSync(
    process.execPath,
    ['scripts/prepare-release.mjs', 'patch'],
    {
      cwd: root,
      stdio: 'pipe',
      encoding: 'utf8',
    },
  );
}

test('release preparation promotes only changes after the previous production', () => {
  const root = createReleaseRepository([
    {
      version: '1.0.1-dev.10',
      channel: 'dev',
      type: 'feat',
      title: 'Busca melhor',
      body: 'A busca ficou mais precisa.',
      pr: 10,
      date: '2026-08-01T00:00:00Z',
    },
    {
      version: '1.0.0',
      channel: 'prod',
      title: 'Voxen 1.0.0',
      body: 'Produção anterior.',
      promoted: [],
      date: '2026-07-01T00:00:00Z',
    },
    {
      version: '0.9.1-dev.5',
      channel: 'dev',
      type: 'fix',
      title: 'Mudança já lançada',
      body: 'Não pertence à produção nova.',
      pr: 5,
      date: '2026-06-01T00:00:00Z',
    },
  ]);

  prepare(root);

  const rootPackage = JSON.parse(
    readFileSync(join(root, 'package.json'), 'utf8'),
  );
  const webPackage = JSON.parse(
    readFileSync(join(root, 'apps/web/package.json'), 'utf8'),
  );
  const releases = JSON.parse(
    readFileSync(join(root, 'releases.json'), 'utf8'),
  );

  assert.equal(rootPackage.version, '1.0.1');
  assert.equal(webPackage.version, '1.0.1');
  assert.equal(releases[0].channel, 'prod');
  assert.equal(releases[0].version, '1.0.1');
  assert.equal(releases[0].title, 'Voxen 1.0.1 — busca confiável');
  assert.deepEqual(
    releases[0].promoted.map((entry) => entry.title),
    ['Busca melhor'],
  );
  assert.match(
    readFileSync(join(root, 'CHANGELOG.md'), 'utf8'),
    /v1\.0\.1.+Produção/,
  );
  assert.match(
    readFileSync(join(root, 'changelog/RELEASE.md'), 'utf8'),
    /busca confiável/,
  );

  prepare(root);
  const repeatedReleases = JSON.parse(
    readFileSync(join(root, 'releases.json'), 'utf8'),
  );
  assert.equal(
    repeatedReleases.filter(
      (entry) => entry.channel === 'prod' && entry.version === '1.0.1',
    ).length,
    1,
  );
});

for (const [label, invalidFeed] of [
  ['malformed JSON', '{invalid'],
  ['non-array root', '{"channel":"dev"}\n'],
]) {
  test(`release preparation fails closed for ${label}`, () => {
    const root = createReleaseRepository(invalidFeed);
    const originalFeed = readFileSync(join(root, 'releases.json'), 'utf8');

    assert.throws(() => prepare(root));
    assert.equal(
      readFileSync(join(root, 'releases.json'), 'utf8'),
      originalFeed,
    );
    assert.equal(
      JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
      '1.0.0',
    );
    assert.equal(
      JSON.parse(readFileSync(join(root, 'apps/web/package.json'), 'utf8'))
        .version,
      '1.0.0',
    );
    assert.equal(existsSync(join(root, 'CHANGELOG.md')), false);
  });
}

test('release preparation fails closed when the feed is missing', () => {
  const root = createReleaseRepository([]);
  unlinkSync(join(root, 'releases.json'));

  assert.throws(() => prepare(root));
  assert.equal(existsSync(join(root, 'releases.json')), false);
  assert.equal(
    JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
    '1.0.0',
  );
  assert.equal(
    JSON.parse(readFileSync(join(root, 'apps/web/package.json'), 'utf8'))
      .version,
    '1.0.0',
  );
  assert.equal(existsSync(join(root, 'CHANGELOG.md')), false);
});

test('release instructions enforce a version-only squash subject and blank body', () => {
  const root = createReleaseRepository([]);
  const output = prepare(root);

  assert.match(
    output,
    /gh pr create --base main --label release:patch --title "v1\.0\.1"/,
  );
  assert.match(
    output,
    /gh pr merge <PR> --squash --delete-branch --subject "v1\.0\.1" --body ""/,
  );
  assert.doesNotMatch(output, /--title "release: v/);
});
