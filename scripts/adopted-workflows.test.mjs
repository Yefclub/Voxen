import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function frontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, "SKILL.md sem frontmatter");
  const fields = {};
  for (const line of match[1].split("\n")) {
    const field = line.match(/^(\w+):\s*(.*)$/);
    if (field) fields[field[1]] = field[2];
  }
  return fields;
}

for (const name of [
  "test-audit",
  "anti-slop",
  "issue-plan",
  "debug",
  "security-audit",
  "browser-validation",
]) {
  test(`adopted workflow ${name} is discoverable with explicit contract`, () => {
    const path = `.claude/skills/${name}/SKILL.md`;
    assert.ok(existsSync(resolve(root, path)), `${path} is missing`);
    const content = read(path);
    const meta = frontmatter(content);
    assert.equal(meta.name, name);
    assert.ok(
      (meta.description ?? "").length >= 30,
      `${name} description does not state when to use it`,
    );
    assert.match(content, /## Quando usar|## Fluxo/);
    assert.match(content, /## O que esta skill N[ÃA]O faz/);
    assert.doesNotMatch(content, /npm install -g|pip install|global/);
  });

  test(`adopted workflow ${name} is mirrored without local state`, () => {
    assert.ok(
      existsSync(resolve(root, `.agents/skills/${name}/SKILL.md`)),
      `.agents mirror of ${name} is missing (run scripts/agents-mirror.mjs --fix)`,
    );
    assert.equal(
      read(`.agents/skills/${name}/SKILL.md`),
      read(`.claude/skills/${name}/SKILL.md`)
        .split(".claude/")
        .join(".agents/"),
    );
  });
}

test("adopted workflows complement review without duplicating it", () => {
  const audit = read(".claude/skills/test-audit/SKILL.md");
  assert.match(audit, /review-pr/);
  assert.match(audit, /N[aã]o aprova merge sozinha/);
  const slop = read(".claude/skills/anti-slop/SKILL.md");
  assert.match(slop, /review-pr/);
  assert.match(slop, /N[aã]o edita código/);
  const plan = read(".claude/skills/issue-plan/SKILL.md");
  assert.match(plan, /sem pedido|sem pedir/i);
  assert.match(plan, /reler o que foi criado|read-back/i);
  const debug = read(".claude/skills/debug/SKILL.md");
  assert.match(debug, /N[aã]o conclui por analogia|nunca com relato/i);
  assert.match(debug, /reproduzir|reproduz/i);
  const secaudit = read(".claude/skills/security-audit/SKILL.md");
  assert.match(secaudit, /confirmado|refutado/i);
  assert.match(
    secaudit,
    /N[aã]o declara "seguro"|nunca com relato|sem segredos/i,
  );
  const browser = read(".claude/skills/browser-validation/SKILL.md");
  assert.match(browser, /headless/i);
  assert.match(browser, /revis[aã]o carregada/i);
  assert.match(browser, /N[aã]o redesenha UI|n[aã]o publica/i);
});
