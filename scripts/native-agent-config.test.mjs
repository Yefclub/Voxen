import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function section(text, name) {
  const match = text.match(new RegExp(`^\\[${name}\\][^[]*`, "m"));
  assert.ok(match, `[${name}] section is missing`);
  return match[0];
}

test("project codex config stays within the native project scope", () => {
  const config = read(".codex/config.toml");
  const agents = section(config, "agents");
  assert.match(agents, /max_concurrent_threads_per_session\s*=\s*\d+/);
  for (const forbidden of [
    "model_provider",
    "model_providers",
    "openai_base_url",
    "chatgpt_base_url",
    "notify",
    "otel",
  ]) {
    assert.doesNotMatch(
      config,
      new RegExp(`^\\s*${forbidden}\\s*=`, "m"),
      `${forbidden} is not settable from project scope`,
    );
  }
  assert.doesNotMatch(config, /^\s*model\s*=/m);
  assert.doesNotMatch(config, /^\s*profile\s*=/m);
  assert.doesNotMatch(config, /^\s*profiles\s*\./m);
});

test("native roles pin explicit model and effort without touching account settings", () => {
  const implementer = read(".codex/agents/implementer.toml");
  assert.match(implementer, /^name\s*=\s*"implementer"/m);
  assert.match(implementer, /^model\s*=\s*"gpt-6\.1-sol"/m);
  assert.match(implementer, /^model_reasoning_effort\s*=\s*"high"/m);
  assert.match(implementer, /never self-approves?\b/i);

  const reviewer = read(".codex/agents/code-reviewer.toml");
  assert.match(reviewer, /^name\s*=\s*"code-reviewer"/m);
  assert.match(reviewer, /^model\s*=\s*"gpt-6\.1-sol"/m);
  assert.match(reviewer, /^model_reasoning_effort\s*=\s*"high"/m);
  assert.match(reviewer, /MUDANCAS NECESSARIAS/);
  assert.match(reviewer, /BLOQUEADO/);
  assert.match(reviewer, /do not edit files/i);
  const features = section(reviewer, "features");
  assert.match(features, /shell_tool\s*=\s*false/);
  assert.match(features, /memories\s*=\s*false/);
  assert.doesNotMatch(reviewer, /Comentário único no PR/);
  assert.doesNotMatch(reviewer, /Comente no PR/);
  assert.doesNotMatch(reviewer, /🤖/);

  for (const [file, name] of [
    [".codex/agents/implementer.toml", "implementer"],
    [".codex/agents/code-reviewer.toml", "code-reviewer"],
  ]) {
    assert.equal(
      existsSync(resolve(root, `.codex/agents/${name}.toml`)),
      true,
      `${file} filename must match the agent name`,
    );
  }
});

test("native config complements the mirror instead of replacing it", () => {
  const agents = read("AGENTS.md");
  assert.match(agents, /\.codex\//);
  assert.match(agents, /não/);
  assert.match(agents, /espelhada/);
  assert.ok(
    existsSync(resolve(root, ".codex/config.toml")),
    ".codex/config.toml is missing",
  );
  assert.ok(
    !existsSync(resolve(root, ".codex/settings.local.json")),
    "local Codex state must not be versioned",
  );
});
