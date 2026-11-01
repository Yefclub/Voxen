import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

function settings() {
  return JSON.parse(
    readFileSync(resolve(root, ".claude/settings.json"), "utf8"),
  );
}

test("agent permissions never grant blanket shell or privilege escalation", () => {
  const { allow } = settings().permissions;
  for (const entry of allow) {
    assert.doesNotMatch(entry, /^Bash\(\*\)$/);
    assert.doesNotMatch(entry, /^Bash\(sudo\b/i);
    assert.doesNotMatch(entry, /^Bash\(su\b/i);
    assert.doesNotMatch(entry, /^Bash\(chmod \+s/i);
  }
  assert.ok(!allow.includes("Bash(*)"), "blanket shell access is forbidden");
});

test("agent permissions deny destructive git and supply-chain operations", () => {
  const { deny } = settings().permissions;
  for (const blocked of [
    "Bash(git push --force*)",
    "Bash(git push -f*)",
    "Bash(git reset --hard*)",
    "Bash(git clean -f*)",
    "Bash(git branch -D*)",
    "Bash(curl * | sh*)",
    "Bash(npm publish*)",
    "Bash(gh repo delete*)",
  ]) {
    assert.ok(deny.includes(blocked), `${blocked} must stay denied`);
  }
});

test("agent permissions expose no destructive gh scopes or credential paths", () => {
  const { allow } = settings().permissions;
  for (const entry of allow) {
    assert.doesNotMatch(
      entry,
      /gh (repo delete|release delete|secret|auth login|auth refresh)/,
    );
    assert.doesNotMatch(entry, /\.env|master\.key|\.pem|\.p12|secrets\//);
  }
  assert.ok(!allow.includes("Bash(gh push*)"), "no blanket gh push");
});
