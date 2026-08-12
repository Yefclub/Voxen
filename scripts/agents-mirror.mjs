#!/usr/bin/env node
// Checks, or repairs, the `.agents/` mirror of `.claude/`.
//
//   node scripts/agents-mirror.mjs          # report drift, exit 1 when dirty
//   node scripts/agents-mirror.mjs --fix    # regenerate the mirror from .claude/
//
// The check also runs as a test (scripts/agents-mirror.test.mjs), inside the
// already-required "Test TS (apps/web)" job, so CI blocks a pull request that
// edits one tree and not the other.

import { argv, exit, stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

import {
  MIRROR_SOURCE,
  MIRROR_TARGET,
  diffMirror,
  formatExcludedNote,
  formatMirrorReport,
  isMirrorClean,
  syncMirror,
} from "./agents-mirror-lib.mjs";

// Anchored to the script's own location, never to the working directory. With
// cwd() this reported "matches" from any subdirectory, because both trees were
// absent and an empty comparison looks clean — a guard announcing success
// without reading a file is the failure it exists to prevent.
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

function main() {
  const root = REPO_ROOT;

  if (argv.includes("--fix")) {
    const { written, removed, excluded } = syncMirror(root);
    for (const relative of written) {
      stdout.write(`synced   ${MIRROR_TARGET}/${relative}\n`);
    }
    for (const relative of removed) {
      stdout.write(`removed  ${MIRROR_TARGET}/${relative}\n`);
    }
    const total = written.length + removed.length;
    stdout.write(
      total === 0
        ? `${MIRROR_TARGET}/ already matches ${MIRROR_SOURCE}/\n`
        : `\n${total} file(s) updated. Commit them with the ${MIRROR_SOURCE}/ change.\n`,
    );
    const note = formatExcludedNote(excluded);
    if (note) stdout.write(`${note}\n`);
    return 0;
  }

  const result = diffMirror(root);
  const note = formatExcludedNote(result.excluded);
  if (isMirrorClean(result)) {
    stdout.write(`${MIRROR_TARGET}/ matches ${MIRROR_SOURCE}/\n`);
    if (note) stdout.write(`${note}\n`);
    return 0;
  }
  if (note) stderr.write(`${note}\n`);

  stderr.write(
    `${MIRROR_TARGET}/ is out of sync with ${MIRROR_SOURCE}/.\n\n` +
      `${formatMirrorReport(result)}\n\n` +
      `${MIRROR_TARGET}/ is what Codex loads. When the two trees drift, the two\n` +
      `harnesses follow different rules. Regenerate and commit the result:\n\n` +
      `    node scripts/agents-mirror.mjs --fix\n`,
  );
  return 1;
}

exit(main());
