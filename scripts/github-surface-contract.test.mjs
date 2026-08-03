import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

test("ship skills require English pull-request surfaces in both harnesses", () => {
  for (const path of [
    ".agents/skills/ship/SKILL.md",
    ".claude/skills/ship/SKILL.md",
  ]) {
    const skill = read(path);
    assert.match(skill, /--title "<English Conventional Commit title>"/);
    assert.match(skill, /--body "<detailed English body>"/);
    assert.match(skill, /quality-gate-report/);
    assert.match(skill, /Never relax `quality-gate\/baseline\.json`/);
    assert.match(skill, /prisma-migration-gate-report/);
    assert.match(skill, /never edit, rename, or delete a migration/);
    assert.doesNotMatch(skill, /título em PT-BR|corpo detalhado em PT-BR/);
  }
});

test("version bot creates an English pull request and workflow output", () => {
  const workflow = read(".github/workflows/version-dev.yml");

  assert.match(workflow, /Automatic dev version bump/);
  assert.match(workflow, /Nine exact required checks passed/);
  assert.match(workflow, /\.name == "Quality Gate"/);
  assert.match(workflow, /\.name == "Prisma migration gate"/);
  assert.match(workflow, /REQUIRED_TOTAL:-0}" = "9"/);
  assert.doesNotMatch(workflow, /Bump automático|Sete required checks/);
});

test("quality evidence survives producer and collector failures", () => {
  const workflow = read(".github/workflows/ci.yml");
  const start = workflow.indexOf("  quality-gate:");
  const end = workflow.indexOf("  prisma-migration-gate:", start);
  const job = workflow.slice(start, end);

  assert.match(
    job,
    /needs: \[test-ts, test-py-worker\]\n    if: \$\{\{ always\(\) \}\}/,
  );
  for (const step of [
    "Download web coverage",
    "Download worker coverage",
    "Preserve raw coverage evidence",
    "Collect duplication evidence",
    "Evaluate quality ratchet",
  ]) {
    assert.match(
      job,
      new RegExp(`- name: ${step}\\n        if: \\$\\{\\{ always\\(\\) \\}\\}`),
    );
  }
  assert.match(job, /if-no-files-found: error/);
});

test("migration gate uses isolated databases and retains diagnostics", () => {
  const workflow = read(".github/workflows/ci.yml");
  const start = workflow.indexOf("  prisma-migration-gate:");
  const end = workflow.indexOf("  docker-build-web:", start);
  const job = workflow.slice(start, end);

  assert.match(job, /name: Prisma migration gate/);
  assert.match(job, /MIGRATION_GATE_DATABASE_URL:/);
  assert.match(job, /MIGRATION_GATE_SHADOW_DATABASE_URL:/);
  assert.match(job, /job\.services\.postgres\.id/);
  assert.match(
    job,
    /- name: Validate migration history and replay\n        if: \$\{\{ always\(\) \}\}/,
  );
  assert.match(job, /name: prisma-migration-gate-report/);
  assert.match(job, /if-no-files-found: error/);
});

test("release gate requires the exact version-only pull-request title", () => {
  const workflow = read(".github/workflows/pr-release-labels.yml");

  assert.match(workflow, /PR_TITLE:.*github\.event\.pull_request\.title/);
  assert.match(workflow, /\[ "\$PR_TITLE" != "v\$root_version" \]/);
  assert.match(workflow, /Release PR title must be exactly v\$root_version/);
});
