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
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, posix } from "node:path";

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
const DENIED_SEGMENTS = new Set([
  ".git",
  "node_modules",
  "secrets",
  "worktrees",
]);
const DENIED_NAMES = new Set([
  "settings.local.json",
  "scheduled_tasks.lock",
  "master.key",
]);
// Mirrors the "Env / secrets (NUNCA commitar)" block of .gitignore.
const DENIED_SUFFIXES = [".key", ".p12", ".pem"];

function isDeniedStatically(relative) {
  const segments = relative.split(posix.sep);
  if (segments.some((segment) => DENIED_SEGMENTS.has(segment))) return true;
  const name = segments[segments.length - 1];
  if (DENIED_NAMES.has(name)) return true;
  if (name === ".env" || name.startsWith(".env.")) return true;
  return DENIED_SUFFIXES.some((suffix) => name.endsWith(suffix));
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
      // Truncating git's answer would drop exclusions, which fails towards
      // copying more than intended — the wrong direction for this check.
      maxBuffer: Infinity,
    });
    return new Set(output.split("\0").filter(Boolean));
  } catch {
    // Exit 1 means "nothing matched", a valid answer with no output. Anything
    // else (128 outside a repository, ENOENT without git) means git could not
    // answer. Both end here, and the static deny set carries the check alone.
    return new Set();
  }
}

export function isValidUtf8(bytes) {
  return Buffer.compare(Buffer.from(bytes.toString("utf8"), "utf8"), bytes) === 0;
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

/**
 * Walks `base`, separating the files that participate in the mirror from the
 * ones deliberately left out. Callers surface `excluded`: a guard that drops
 * files without saying so is the failure mode it exists to prevent.
 *
 * @returns {{files: string[], excluded: string[]}} relative paths, sorted.
 */
export function collectMirrorEntries(root, base) {
  const absoluteBase = join(root, base);
  const candidates = [];
  const excluded = [];

  const walk = (directory, prefix) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relative = prefix ? posix.join(prefix, entry.name) : entry.name;
      if (isDeniedStatically(relative)) {
        excluded.push(relative);
        continue;
      }
      // Symlinks are skipped on both sides: following one on write would put
      // bytes outside the mirror, and there is no legitimate use for one here.
      if (entry.isSymbolicLink()) {
        excluded.push(relative);
        continue;
      }
      if (entry.isDirectory()) walk(join(directory, entry.name), relative);
      else if (entry.isFile()) candidates.push(relative);
    }
  };

  try {
    if (!statSync(absoluteBase).isDirectory()) return { files: [], excluded };
  } catch {
    return { files: [], excluded };
  }
  walk(absoluteBase, "");

  const ignored = gitIgnoredPaths(
    root,
    candidates.map((relative) => `${base}/${relative}`),
  );
  const files = [];
  for (const relative of candidates) {
    if (ignored.has(`${base}/${relative}`)) excluded.push(relative);
    else files.push(relative);
  }
  return { files: files.sort(), excluded: excluded.sort() };
}

export function listMirroredFiles(root, base) {
  return collectMirrorEntries(root, base).files;
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
  return isValidUtf8(bytes) ? { text: bytes.toString("utf8") } : { bytes };
}

// Byte equality first. The line-ending fallback exists only because a Windows
// checkout rewrites both trees, and it is gated on both sides being valid
// UTF-8: `toString("utf8")` maps every invalid sequence to U+FFFD, so two
// different binaries would compare equal and a corrupted mirror would read
// clean.
function mirrorMatches(expected, actual) {
  if (Buffer.compare(expected, actual) === 0) return true;
  if (!isValidUtf8(expected) || !isValidUtf8(actual)) return false;
  return (
    normalizeEol(expected.toString("utf8")) ===
    normalizeEol(actual.toString("utf8"))
  );
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

  const source = collectMirrorEntries(root, MIRROR_SOURCE);
  const sourceFiles = source.files;
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
    if (!mirrorMatches(expected, actual)) diverged.push(relative);
  }

  const extra = targetFiles.filter(
    (relative) => !sourceFiles.includes(relative),
  );

  return { missing, extra, diverged, excluded: source.excluded };
}

export function isMirrorClean({ missing, extra, diverged }) {
  return missing.length === 0 && extra.length === 0 && diverged.length === 0;
}

export function formatExcludedNote(excluded = []) {
  if (excluded.length === 0) return "";
  const shown = excluded.slice(0, 5);
  const rest = excluded.length - shown.length;
  return (
    `skipped ${excluded.length} path(s) under ${MIRROR_SOURCE}/ ` +
    `(ignored or symlinked): ${shown.join(", ")}` +
    (rest > 0 ? `, and ${rest} more` : "")
  );
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
  const { missing, extra, diverged, excluded } = diffMirror(root);
  const written = [...missing, ...diverged].sort();

  for (const relative of written) {
    const target = toAbsolute(root, MIRROR_TARGET, relative);
    mkdirSync(dirname(target), { recursive: true });
    // Remove first: writing onto an existing symlink would follow it and put
    // bytes outside the mirror. `force` tolerates a missing target, and a
    // failure here must surface rather than resurface as a cryptic write error.
    rmSync(target, { force: true, recursive: true });
    writeFileSync(target, expectedMirrorBytes(root, relative));
  }
  for (const relative of extra) {
    rmSync(toAbsolute(root, MIRROR_TARGET, relative), { force: true });
  }

  return { written, removed: extra, excluded };
}

export { toAbsolute };
