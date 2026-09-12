import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  MIRROR_SOURCE,
  MIRROR_TARGET,
  diffMirror,
  formatExcludedNote,
  formatMirrorReport,
  isMirrorClean,
  listMirroredFiles,
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
    writeFileSync(absolute, contents);
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

// --- never promote ignored local state into a versioned tree --------------
//
// The mirror step is a copy. A copy that picks up a gitignored file publishes
// local state — a worktree checkout, a lock file, an env file — into `.agents/`,
// where the matching ignore rules do not exist.

test("skips locally ignored paths even when git cannot be consulted", () => {
  withScaffold(
    {
      [`${MIRROR_SOURCE}/settings.local.json`]: "{}\n",
      [`${MIRROR_SOURCE}/scheduled_tasks.lock`]: "lock\n",
      [`${MIRROR_SOURCE}/skills/x/settings.local.json`]: "{}\n",
      [`${MIRROR_SOURCE}/worktrees/issue-42/.env`]: "MASTER_KEY=secret\n",
      [`${MIRROR_SOURCE}/worktrees/issue-42/apps/web/index.ts`]: "export {};\n",
      [`${MIRROR_SOURCE}/skills/x/SKILL.md`]: "real\n",
      [`${MIRROR_TARGET}/skills/x/SKILL.md`]: "real\n",
    },
    (root) => {
      assert.deepEqual(listMirroredFiles(root, MIRROR_SOURCE), [
        "skills/x/SKILL.md",
      ]);
      assert.ok(isMirrorClean(diffMirror(root)));

      const { written } = syncMirror(root);
      assert.deepEqual(written, []);
      assert.throws(() =>
        readFileSync(join(root, MIRROR_TARGET, "worktrees/issue-42/.env")),
      );
    },
  );
});

test("skips anything git reports as ignored", () => {
  withScaffold(
    {
      ".gitignore": `${MIRROR_SOURCE}/generated/\n`,
      [`${MIRROR_SOURCE}/generated/cache.md`]: "derived\n",
      [`${MIRROR_SOURCE}/skills/x/SKILL.md`]: "real\n",
    },
    (root) => {
      const git = (...args) =>
        execFileSync("git", args, { cwd: root, stdio: "ignore" });
      git("init", "-q");

      assert.deepEqual(listMirroredFiles(root, MIRROR_SOURCE), [
        "skills/x/SKILL.md",
      ]);
    },
  );
});

// --- a guard that reads nothing must not report success -------------------

test("refuses to pass when the source tree is absent", () => {
  withScaffold({ "unrelated.md": "x\n" }, (root) => {
    assert.throws(() => diffMirror(root), /not found/);
  });
});

test("the CLI reports a clean repository from any working directory", () => {
  // The root is anchored to the script, not to cwd. Running from a
  // subdirectory used to find neither tree and call that a match.
  const output = execFileSync(process.execPath, [script], {
    cwd: join(repoRoot, "scripts"),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.match(output, /matches/);
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

test("copies a non-UTF-8 file byte for byte", () => {
  const bytes = Buffer.from([0x00, 0xff, 0xfe, 0x41, 0x80]);
  withScaffold({ [`${MIRROR_SOURCE}/assets/icon.bin`]: bytes }, (root) => {
    syncMirror(root);
    assert.deepEqual(
      readFileSync(join(root, MIRROR_TARGET, "assets/icon.bin")),
      bytes,
    );
    assert.ok(isMirrorClean(diffMirror(root)));
  });
});

test("detects a corrupted binary instead of reporting it clean", () => {
  // `toString("utf8")` maps every invalid sequence to U+FFFD, so comparing two
  // binaries as text makes any pair of them look equal. The line-ending
  // fallback has to be gated on both sides being valid UTF-8, or a corrupted
  // mirror reads clean and --fix rewrites nothing.
  for (const [source, mirror] of [
    [[0x89, 0x50, 0xff, 0x01], [0x89, 0x50, 0xfe, 0x01]],
    [[0x41, 0x0d, 0x0a, 0xff], [0x41, 0x0a, 0xff]],
  ]) {
    withScaffold(
      {
        [`${MIRROR_SOURCE}/assets/icon.bin`]: Buffer.from(source),
        [`${MIRROR_TARGET}/assets/icon.bin`]: Buffer.from(mirror),
      },
      (root) => {
        assert.deepEqual(diffMirror(root).diverged, ["assets/icon.bin"]);
        assert.deepEqual(syncMirror(root).written, ["assets/icon.bin"]);
        assert.deepEqual(
          readFileSync(join(root, MIRROR_TARGET, "assets/icon.bin")),
          Buffer.from(source),
        );
      },
    );
  }
});

test("reports what it skipped instead of dropping it silently", () => {
  withScaffold(
    {
      [`${MIRROR_SOURCE}/skills/x/SKILL.md`]: "real\n",
      [`${MIRROR_SOURCE}/scheduled_tasks.lock`]: "lock\n",
      [`${MIRROR_SOURCE}/worktrees/issue-1/.env`]: "SECRET=1\n",
      [`${MIRROR_SOURCE}/local.pem`]: "key\n",
    },
    (root) => {
      const { excluded } = diffMirror(root);
      assert.deepEqual(excluded, [
        "local.pem",
        "scheduled_tasks.lock",
        "worktrees",
      ]);
      assert.match(formatExcludedNote(excluded), /skipped 3 path\(s\)/);
      assert.equal(formatExcludedNote([]), "");
    },
  );
});

test("the CLI exits 1 and points at --fix when the trees drift", () => {
  // The branch that actually blocks CI. Exercised through a copy of the
  // scripts so the CLI resolves a temporary root instead of the repository.
  withScaffold(
    {
      [`${MIRROR_SOURCE}/skills/a/SKILL.md`]: "body\n",
      [`${MIRROR_TARGET}/.keep`]: "",
    },
    (root) => {
      mkdirSync(join(root, "scripts"), { recursive: true });
      for (const name of ["agents-mirror.mjs", "agents-mirror-lib.mjs"]) {
        writeFileSync(
          join(root, "scripts", name),
          readFileSync(join(scriptsDir, name)),
        );
      }
      assert.throws(
        () =>
          execFileSync(
            process.execPath,
            [join(root, "scripts", "agents-mirror.mjs")],
            { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          ),
        (error) => {
          assert.equal(error.status, 1);
          assert.match(error.stderr, /out of sync/);
          assert.match(error.stderr, /missing\s+\.agents\/skills\/a\/SKILL\.md/);
          assert.match(error.stderr, /agents-mirror\.mjs --fix/);
          return true;
        },
      );
    },
  );
});

test("does not follow symlinks on either side", () => {
  const root = scaffold({
    [`${MIRROR_SOURCE}/skills/a/SKILL.md`]: "body\n",
    "outside.md": "untouched\n",
  });
  try {
    mkdirSync(join(root, MIRROR_TARGET, "skills/a"), { recursive: true });
    try {
      symlinkSync(
        join(root, "outside.md"),
        join(root, MIRROR_TARGET, "skills/a/SKILL.md"),
      );
    } catch {
      return; // Windows without developer mode cannot create symlinks.
    }
    syncMirror(root);
    assert.equal(readFileSync(join(root, "outside.md"), "utf8"), "untouched\n");
    assert.equal(
      readFileSync(join(root, MIRROR_TARGET, "skills/a/SKILL.md"), "utf8"),
      "body\n",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
      assert.equal(
        readFileSync(join(root, MIRROR_TARGET, "skills/a/SKILL.md"), "utf8"),
        "see `.agents/skills/a`\n",
      );
      assert.throws(() =>
        readFileSync(join(root, MIRROR_TARGET, "skills/gone/SKILL.md")),
      );
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
