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

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, posix, sep } from "node:path";

export const MIRROR_SOURCE = ".claude";
export const MIRROR_TARGET = ".agents";

// Local, machine-specific configuration. AGENTS.md excludes it explicitly and
// .gitignore keeps it out of the repository.
export const MIRROR_EXCLUDED = ["settings.local.json"];

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
  const found = [];

  const walk = (directory, prefix) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relative = prefix ? posix.join(prefix, entry.name) : entry.name;
      if (MIRROR_EXCLUDED.includes(relative)) continue;
      if (entry.isDirectory()) walk(join(directory, entry.name), relative);
      else if (entry.isFile()) found.push(relative);
    }
  };

  try {
    if (!statSync(absoluteBase).isDirectory()) return found;
  } catch {
    return found;
  }
  walk(absoluteBase, "");
  return found.sort();
}

function toAbsolute(root, base, relative) {
  return join(root, base, ...relative.split(posix.sep).join(sep).split(sep));
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
  const sourceFiles = listMirroredFiles(root, MIRROR_SOURCE);
  const targetFiles = listMirroredFiles(root, MIRROR_TARGET);

  const missing = [];
  const diverged = [];

  for (const relative of sourceFiles) {
    if (!targetFiles.includes(relative)) {
      missing.push(relative);
      continue;
    }
    const expected = normalizeEol(
      rewriteToMirror(
        readFileSync(toAbsolute(root, MIRROR_SOURCE, relative), "utf8"),
      ),
    );
    const actual = normalizeEol(
      readFileSync(toAbsolute(root, MIRROR_TARGET, relative), "utf8"),
    );
    if (expected !== actual) diverged.push(relative);
  }

  const extra = targetFiles.filter((relative) => !sourceFiles.includes(relative));

  return { missing, extra, diverged };
}

export function isMirrorClean({ missing, extra, diverged }) {
  return missing.length === 0 && extra.length === 0 && diverged.length === 0;
}

export function formatMirrorReport({ missing, extra, diverged }) {
  const lines = [];
  for (const relative of missing) {
    lines.push(`missing   ${MIRROR_TARGET}/${relative}  (only in ${MIRROR_SOURCE}/)`);
  }
  for (const relative of diverged) {
    lines.push(`diverged  ${MIRROR_TARGET}/${relative}  (content differs)`);
  }
  for (const relative of extra) {
    lines.push(`extra     ${MIRROR_TARGET}/${relative}  (no counterpart in ${MIRROR_SOURCE}/)`);
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
    // Write the source bytes with the path rewrite applied, leaving the
    // source's own line endings intact; comparison normalizes them anyway.
    writeFileSync(
      target,
      rewriteToMirror(
        readFileSync(toAbsolute(root, MIRROR_SOURCE, relative), "utf8"),
      ),
      "utf8",
    );
  }
  for (const relative of extra) {
    rmSync(toAbsolute(root, MIRROR_TARGET, relative), { force: true });
  }

  return { written, removed: extra };
}

export { toAbsolute };
