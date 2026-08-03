import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const projectRoot = new URL('..', import.meta.url).pathname;

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

test('release preparation materializes a reviewable production feed entry', () => {
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
  writeJson(join(root, 'releases.json'), [
    {
      version: '1.0.1-dev.10',
      channel: 'dev',
      type: 'feat',
      title: 'Busca melhor',
      body: 'A busca ficou mais precisa.',
      pr: 10,
      date: '2026-08-01T00:00:00Z',
    },
  ]);
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

  execFileSync(process.execPath, ['scripts/prepare-release.mjs', 'patch'], {
    cwd: root,
    stdio: 'pipe',
  });

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
  assert.equal(releases[0].promoted.length, 1);
  assert.match(
    readFileSync(join(root, 'CHANGELOG.md'), 'utf8'),
    /v1\.0\.1.+Produção/,
  );
  assert.match(
    readFileSync(join(root, 'changelog/RELEASE.md'), 'utf8'),
    /busca confiável/,
  );

  execFileSync(process.execPath, ['scripts/prepare-release.mjs', 'patch'], {
    cwd: root,
    stdio: 'pipe',
  });
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
