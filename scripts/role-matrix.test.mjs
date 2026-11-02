import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

test("role matrix matches the native role files", () => {
  const matrix = read("AGENTS.md");
  const implementer = read(".codex/agents/implementer.toml");
  const reviewer = read(".codex/agents/code-reviewer.toml");

  for (const token of [
    "gpt-6.1-sol",
    "`high`",
    "implementer.toml",
    "code-reviewer.toml",
  ]) {
    assert.match(
      matrix,
      new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
  assert.match(implementer, /^model\s*=\s*"gpt-6\.1-sol"/m);
  assert.match(implementer, /^model_reasoning_effort\s*=\s*"high"/m);
  assert.match(reviewer, /^model\s*=\s*"gpt-6\.1-sol"/m);
  assert.match(reviewer, /^model_reasoning_effort\s*=\s*"high"/m);
  assert.match(reviewer, /shell_tool\s*=\s*false/);
  assert.match(reviewer, /memories\s*=\s*false/);
});

test("role matrix documents the review route and fallback honestly", () => {
  const matrix = read("AGENTS.md");
  assert.match(matrix, /APROVADO/);
  assert.match(matrix, /MUDANCAS NECESSARIAS/);
  assert.match(matrix, /BLOQUEADO/);
  assert.match(matrix, /fallback/i);
  assert.match(
    matrix,
    /Trocar de revisor.*proibido|evidência ausente permanece bloqueio/i,
  );
  assert.match(matrix, /nunca substitui review/i);
  assert.doesNotMatch(
    matrix,
    /Impeccable (está instalado|instalado|disponível nos dois clientes)/i,
  );
});
