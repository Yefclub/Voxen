import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  MIRROR_SOURCE,
  MIRROR_TARGET,
  diffMirror,
  formatMirrorReport,
  isMirrorClean,
  normalizeEol,
  rewriteToMirror,
  syncMirror,
} from "./agents-mirror-lib.mjs";

const scriptsDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(scriptsDir, "..");
const script = join(scriptsDir, "agents-mirror.mjs");

function scaffold(files) {
  const root = mkdtempSync(join(tmpdir(), "voxen-agents-mirror-"));
  for (const [relative, contents] of Object.entries(files)) {
    const absolute = join(root, relative);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents, "utf8");
  }
  return root;
}

function withScaffold(files, run) {
  const root = scaffold(files);
  try {
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// --- the contract that matters -------------------------------------------

test("the repository mirror is in sync", () => {
  const result = diffMirror(repoRoot);
  assert.ok(
    isMirrorClean(result),
    `${MIRROR_TARGET}/ drifted from ${MIRROR_SOURCE}/. ` +
      `Run \`node scripts/agents-mirror.mjs --fix\` and commit the result.\n` +
      formatMirrorReport(result),
  );
});

// --- unit behaviour -------------------------------------------------------

test("rewrites source path references to the mirror", () => {
  assert.equal(
    rewriteToMirror("read `.claude/skills/ship/SKILL.md` first"),
    "read `.agents/skills/ship/SKILL.md` first",
  );
});

test("leaves a bare source name without a trailing slash alone", () => {
  // `.claude` on its own is prose about the directory, not a path into it.
  assert.equal(rewriteToMirror("the .claude tree"), "the .claude tree");
});

test("reports a file that never reached the mirror", () => {
  withScaffold(
    {
      [`${MIRROR_SOURCE}/skills/new/SKILL.md`]: "body\n",
      [`${MIRROR_TARGET}/.keep`]: "",
    },
    (root) => {
      const result = diffMirror(root);
      assert.deepEqual(result.missing, ["skills/new/SKILL.md"]);
      assert.deepEqual(result.diverged, []);
      assert.deepEqual(result.extra, [".keep"]);
      assert.equal(isMirrorClean(result), false);
    },
  );
});

test("reports content that drifted", () => {
  withScaffold(
    {
      [`${MIRROR_SOURCE}/skills/ship/SKILL.md`]: "new rule\n",
      [`${MIRROR_TARGET}/skills/ship/SKILL.md`]: "old rule\n",
    },
    (root) => {
      const result = diffMirror(root);
      assert.deepEqual(result.diverged, ["skills/ship/SKILL.md"]);
      assert.deepEqual(result.missing, []);
      assert.deepEqual(result.extra, []);
    },
  );
});

test("accepts a mirror that differs only by the rewritten path", () => {
  withScaffold(
    {
      [`${MIRROR_SOURCE}/skills/a/SKILL.md`]: "see `.claude/skills/b`\n",
      [`${MIRROR_TARGET}/skills/a/SKILL.md`]: "see `.agents/skills/b`\n",
    },
    (root) => assert.ok(isMirrorClean(diffMirror(root))),
  );
});

test("ignores line-ending differences between the trees", () => {
  withScaffold(
    {
      [`${MIRROR_SOURCE}/skills/a/SKILL.md`]: "one\r\ntwo\r\n",
      [`${MIRROR_TARGET}/skills/a/SKILL.md`]: "one\ntwo\n",
    },
    (root) => assert.ok(isMirrorClean(diffMirror(root))),
  );
  assert.equal(normalizeEol("a\r\nb"), "a\nb");
});

test("does not mirror local settings", () => {
  withScaffold(
    { [`${MIRROR_SOURCE}/settings.local.json`]: "{}\n" },
    (root) => assert.ok(isMirrorClean(diffMirror(root))),
  );
});

test("--fix adds, rewrites, and prunes until the trees match", () => {
  withScaffold(
    {
      [`${MIRROR_SOURCE}/skills/a/SKILL.md`]: "see `.claude/skills/a`\n",
      [`${MIRROR_SOURCE}/skills/b/SKILL.md`]: "fresh\n",
      [`${MIRROR_TARGET}/skills/a/SKILL.md`]: "stale\n",
      [`${MIRROR_TARGET}/skills/gone/SKILL.md`]: "removed upstream\n",
    },
    (root) => {
      const { written, removed } = syncMirror(root);
      assert.deepEqual(written, ["skills/a/SKILL.md", "skills/b/SKILL.md"]);
      assert.deepEqual(removed, ["skills/gone/SKILL.md"]);
      assert.ok(isMirrorClean(diffMirror(root)));
    },
  );
});

test("--fix is idempotent", () => {
  withScaffold(
    { [`${MIRROR_SOURCE}/skills/a/SKILL.md`]: "body\n" },
    (root) => {
      syncMirror(root);
      const second = syncMirror(root);
      assert.deepEqual(second.written, []);
      assert.deepEqual(second.removed, []);
    },
  );
});

// --- CLI ------------------------------------------------------------------

test("the CLI exits 0 on a clean tree and 1 on a dirty one", () => {
  const run = (root) =>
    execFileSync(process.execPath, [script], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

  withScaffold(
    {
      [`${MIRROR_SOURCE}/skills/a/SKILL.md`]: "body\n",
      [`${MIRROR_TARGET}/skills/a/SKILL.md`]: "body\n",
    },
    (root) => assert.match(run(root), /matches/),
  );

  withScaffold(
    { [`${MIRROR_SOURCE}/skills/a/SKILL.md`]: "body\n" },
    (root) => {
      assert.throws(
        () => run(root),
        (error) => {
          assert.equal(error.status, 1);
          assert.match(error.stderr, /out of sync/);
          assert.match(error.stderr, /agents-mirror\.mjs --fix/);
          return true;
        },
      );
    },
  );
});
