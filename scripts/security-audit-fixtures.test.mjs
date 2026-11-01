import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

const FIXTURES = [
  ["confirmed-finding.md", /confirmado/],
  ["refuted-candidate.md", /refutado/],
  ["missing-evidence.md", /n[aã]o verificado/i],
  ["partial-inventory.md", /cobertura parcial/i],
  ["zero-findings-unverified.md", /n[aã]o [ée] aprova[cç][aã]o/i],
];

for (const [file, marker] of FIXTURES) {
  test(`security-audit fixture ${file} declares its verdict class`, () => {
    const content = read(`.claude/skills/security-audit/fixtures/${file}`);
    assert.match(content, marker);
    assert.match(content, /snapshot/);
  });

  test(`security-audit fixture ${file} is mirrored without secrets`, () => {
    const mirrorPath = `.agents/skills/security-audit/fixtures/${file}`;
    assert.ok(
      existsSync(resolve(root, mirrorPath)),
      `${mirrorPath} is missing`,
    );
    for (const content of [
      read(`.claude/skills/security-audit/fixtures/${file}`),
      read(mirrorPath),
    ]) {
      assert.doesNotMatch(content, /sk-[A-Za-z0-9]{8,}/);
      assert.doesNotMatch(content, /Bearer\s+[A-Za-z0-9._~+/-]{8,}/i);
      assert.doesNotMatch(content, /BEGIN [A-Z ]*PRIVATE KEY/);
    }
  });
}

test("security-audit fixtures index matches the skill contract", () => {
  const index = read(".claude/skills/security-audit/fixtures/README.md");
  for (const [file] of FIXTURES) {
    assert.match(index, new RegExp(file.replace(".", "\\.")));
  }
});
