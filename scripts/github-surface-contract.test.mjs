import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('..', import.meta.url).pathname;

function read(path) {
  return readFileSync(join(root, path), 'utf8');
}

test('ship skills require English pull-request surfaces in both harnesses', () => {
  for (const path of [
    '.agents/skills/ship/SKILL.md',
    '.claude/skills/ship/SKILL.md',
  ]) {
    const skill = read(path);
    assert.match(skill, /--title "<English Conventional Commit title>"/);
    assert.match(skill, /--body "<detailed English body>"/);
    assert.match(skill, /quality-gate-report/);
    assert.match(skill, /Never relax `quality-gate\/baseline\.json`/);
    assert.doesNotMatch(skill, /título em PT-BR|corpo detalhado em PT-BR/);
  }
});

test('version bot creates an English pull request and workflow output', () => {
  const workflow = read('.github/workflows/version-dev.yml');

  assert.match(workflow, /Automatic dev version bump/);
  assert.match(workflow, /Eight exact required checks passed/);
  assert.match(workflow, /\.name == "Quality Gate"/);
  assert.match(workflow, /REQUIRED_TOTAL:-0}" = "8"/);
  assert.doesNotMatch(workflow, /Bump automático|Sete required checks/);
});

test('release gate requires the exact version-only pull-request title', () => {
  const workflow = read('.github/workflows/pr-release-labels.yml');

  assert.match(workflow, /PR_TITLE:.*github\.event\.pull_request\.title/);
  assert.match(workflow, /\[ "\$PR_TITLE" != "v\$root_version" \]/);
  assert.match(workflow, /Release PR title must be exactly v\$root_version/);
});
