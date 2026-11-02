import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { builtinModules } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

// Agent tooling covered by this guard: diagnostics, validators, and workflow
// contract tests owned by the agent setup. Migration/deploy scripts legitimately
// use declared helper packages and stay out of scope here.
const GUARDED = [
  "scripts/agent-doctor.mjs",
  "scripts/agent-doctor.test.mjs",
  "scripts/agent-permissions.test.mjs",
  "scripts/agent-stdlib-only.test.mjs",
  "scripts/adopted-workflows.test.mjs",
  "scripts/native-agent-config.test.mjs",
  "scripts/role-matrix.test.mjs",
  "scripts/security-audit-fixtures.test.mjs",
];

const builtins = new Set(
  builtinModules.flatMap((name) => [name, `node:${name}`]),
);

test("agent tooling imports only stdlib and relative modules", () => {
  for (const file of GUARDED) {
    const content = readFileSync(resolve(root, file), "utf8");
    assert.ok(content.length > 0, `${file} is missing`);
    for (const match of content.matchAll(
      /^\s*import\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm,
    )) {
      const specifier = match[1];
      if (specifier.startsWith(".") || specifier.startsWith("node:")) continue;
      assert.ok(
        builtins.has(specifier) || builtins.has(`node:${specifier}`),
        `${file} imports non-stdlib dependency: ${specifier}`,
      );
    }
  }
});

test("agent tooling declares no model-provider configuration", () => {
  for (const file of GUARDED) {
    const content = readFileSync(resolve(root, file), "utf8");
    // Bare mentions are expected (other tests assert these keys stay absent
    // from native config); only real assignments or secret values fail here.
    assert.doesNotMatch(content, /^\s*(openai_base_url|model_provider)\s*=/m);
    assert.doesNotMatch(content, /[:=]\s*["']sk-[A-Za-z0-9]{8,}/);
  }
});

test("guarded file list matches the agent scripts on disk", () => {
  const onDisk = new Set(
    readdirSync(resolve(root, "scripts"))
      .filter((name) =>
        /^(agent-|adopted-workflows|native-agent-config|role-matrix|security-audit-fixtures)/.test(
          name,
        ),
      )
      .map((name) => `scripts/${name}`),
  );
  assert.deepEqual(new Set(GUARDED), onDisk);
});
