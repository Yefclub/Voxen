// Keeps `.agents/` byte-identical to `.claude/`, modulo the `.claude/` ->
// `.agents/` path rewrite that AGENTS.md mandates.
//
// The mirror is what Codex loads. When only one tree is edited the two
// harnesses silently teach different rules, which has already happened once:
// a pull request added skill frontmatter to `.claude/` alone and nothing
// noticed until a reviewer compared the trees by hand.
//
// Known limitation: the rewrite is textual and unconditional, so a mirrored
// file cannot deliberately keep a literal `.claude/` reference. Nothing needs
// that today. If something ever does, exclude the file here rather than
// hand-editing the mirror, or the guard will keep reverting it.

import { execFileSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, posix, sep } from "node:path";

export const MIRROR_SOURCE = ".claude";
export const MIRROR_TARGET = ".agents";

// Static safety net, applied even when git is unavailable.
//
// This must never be the only defence: `.gitignore` is the real source of
// truth and it has drifted from a hand-kept list before. But a mirror step is
// a copy operation, and a copy that silently promotes an ignored file into a
// versioned tree is how local state — a worktree checkout, a lock file, an
// `.env` — ends up committed. So the deny set is checked first and the git
// query only widens it.
const DENIED_SEGMENTS = new Set([".git", "node_modules", "worktrees"]);
const DENIED_NAMES = new Set(["settings.local.json", "scheduled_tasks.lock"]);

function isDeniedStatically(relative) {
  const segments = relative.split(posix.sep);
  if (segments.some((segment) => DENIED_SEGMENTS.has(segment))) return true;
  const name = segments[segments.length - 1];
  return DENIED_NAMES.has(name) || name === ".env" || name.startsWith(".env.");
}

/**
 * Asks git which of `relatives` (repo-relative, posix separators) are ignored.
 * Returns an empty set when git cannot answer — outside a repository, or when
 * git is missing — so callers must not treat this as the only filter.
 */
export function gitIgnoredPaths(root, relatives) {
  if (relatives.length === 0) return new Set();
  try {
    const output = execFileSync("git", ["check-ignore", "--stdin", "-z"], {
      cwd: root,
      input: `${relatives.join("\0")}\0`,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    return new Set(output.split("\0").filter(Boolean));
  } catch (error) {
    // Exit 1 means "nothing matched", which is a valid answer with no output.
    // Anything else (128 outside a repo, ENOENT without git) means git could
    // not answer, and the static deny set carries the check alone.
    if (error?.status === 1) return new Set();
    return new Set();
  }
}

export function rewriteToMirror(source) {
  return source.split(`${MIRROR_SOURCE}/`).join(`${MIRROR_TARGET}/`);
}

// Compare through normalized line endings so the guard behaves the same on a
// Linux runner and on a Windows checkout, where core.autocrlf rewrites both
// trees on the way out of git.
export function normalizeEol(source) {
  return source.replace(/\r\n/g, "\n");
}

export function listMirroredFiles(root, base) {
  const absoluteBase = join(root, base);
  const candidates = [];

  const walk = (directory, prefix) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relative = prefix ? posix.join(prefix, entry.name) : entry.name;
      if (isDeniedStatically(relative)) continue;
      // Symlinks are skipped on both sides: following one on write would put
      // bytes outside the mirror, and there is no legitimate use for one here.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(join(directory, entry.name), relative);
      else if (entry.isFile()) candidates.push(relative);
    }
  };

  try {
    if (!statSync(absoluteBase).isDirectory()) return [];
  } catch {
    return [];
  }
  walk(absoluteBase, "");

  const ignored = gitIgnoredPaths(
    root,
    candidates.map((relative) => `${base}/${relative}`),
  );
  return candidates
    .filter((relative) => !ignored.has(`${base}/${relative}`))
    .sort();
}

function toAbsolute(root, base, relative) {
  return join(root, base, ...relative.split(posix.sep));
}

// Text files get the path rewrite; anything that is not valid UTF-8 is copied
// byte for byte. Reading a binary as utf8 and writing it back is lossy, and
// because both sides of the comparison would suffer the same loss, the guard
// would report a corrupted mirror as clean.
function readForMirror(absolute) {
  const bytes = readFileSync(absolute);
  const text = bytes.toString("utf8");
  const lossless = Buffer.compare(Buffer.from(text, "utf8"), bytes) === 0;
  return lossless ? { text } : { bytes };
}

function expectedMirrorBytes(root, relative) {
  const source = readForMirror(toAbsolute(root, MIRROR_SOURCE, relative));
  return source.bytes ?? Buffer.from(rewriteToMirror(source.text), "utf8");
}

/**
 * Compares the two trees.
 *
 * @returns {{missing: string[], extra: string[], diverged: string[]}}
 *   `missing` exists in `.claude/` but not in `.agents/`;
 *   `extra` exists only in `.agents/`;
 *   `diverged` exists in both but the mirror does not match the rewrite.
 */
export function diffMirror(root) {
  // A missing source tree must be loud. Returning "clean" because nothing was
  // read is the exact failure this guard exists to prevent.
  try {
    if (!statSync(join(root, MIRROR_SOURCE)).isDirectory()) throw new Error();
  } catch {
    throw new Error(
      `${MIRROR_SOURCE}/ not found under ${root}. Run this from the repository root.`,
    );
  }

  const sourceFiles = listMirroredFiles(root, MIRROR_SOURCE);
  const targetFiles = listMirroredFiles(root, MIRROR_TARGET);

  const missing = [];
  const diverged = [];

  for (const relative of sourceFiles) {
    if (!targetFiles.includes(relative)) {
      missing.push(relative);
      continue;
    }
    const expected = expectedMirrorBytes(root, relative);
    const actual = readFileSync(toAbsolute(root, MIRROR_TARGET, relative));
    const same =
      Buffer.compare(expected, actual) === 0 ||
      normalizeEol(expected.toString("utf8")) ===
        normalizeEol(actual.toString("utf8"));
    if (!same) diverged.push(relative);
  }

  const extra = targetFiles.filter(
    (relative) => !sourceFiles.includes(relative),
  );

  return { missing, extra, diverged };
}

export function isMirrorClean({ missing, extra, diverged }) {
  return missing.length === 0 && extra.length === 0 && diverged.length === 0;
}

export function formatMirrorReport({ missing, extra, diverged }) {
  const lines = [];
  for (const relative of missing) {
    lines.push(
      `missing   ${MIRROR_TARGET}/${relative}  (only in ${MIRROR_SOURCE}/)`,
    );
  }
  for (const relative of diverged) {
    lines.push(`diverged  ${MIRROR_TARGET}/${relative}  (content differs)`);
  }
  for (const relative of extra) {
    lines.push(
      `extra     ${MIRROR_TARGET}/${relative}  (no counterpart in ${MIRROR_SOURCE}/)`,
    );
  }
  return lines.join("\n");
}

/**
 * Rewrites the mirror from the source tree.
 *
 * @returns {{written: string[], removed: string[]}}
 */
export function syncMirror(root) {
  const { missing, extra, diverged } = diffMirror(root);
  const written = [...missing, ...diverged].sort();

  for (const relative of written) {
    const target = toAbsolute(root, MIRROR_TARGET, relative);
    mkdirSync(dirname(target), { recursive: true });
    // Remove first: writing onto an existing symlink would follow it and put
    // bytes outside the mirror.
    try {
      lstatSync(target);
      rmSync(target, { force: true });
    } catch {
      // Nothing there yet.
    }
    writeFileSync(target, expectedMirrorBytes(root, relative));
  }
  for (const relative of extra) {
    rmSync(toAbsolute(root, MIRROR_TARGET, relative), { force: true });
  }

  return { written, removed: extra };
}

export { toAbsolute };
