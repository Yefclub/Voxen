#!/usr/bin/env node
// Voxen agent doctor — read-only diagnostics for agent configuration.
// Reports declared (files), effective loaded (not observable without a client),
// and observed execution (explicitly unverified here). Never prints secrets,
// tokens, transcripts, or environment values. Exit 0 on success; exit 2 when
// invoked with --strict and any check is not verified.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function safeRead(path) {
  try {
    return readFileSync(join(root, path), "utf8");
  } catch {
    return null;
  }
}

function listSkills() {
  const out = [];
  for (const base of [".claude/skills", ".agents/skills"]) {
    let entries = [];
    try {
      entries = readdirSync(join(root, base), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillPath = `${base}/${entry.name}/SKILL.md`;
      const content = safeRead(skillPath);
      if (content === null) {
        out.push({ name: entry.name, base, present: false });
        continue;
      }
      const match = content.match(/^---\n([\s\S]*?)\n---\n/);
      const frontmatter = match ? match[1] : "";
      const name =
        (frontmatter.match(/^name:\s*(.*)$/m) ?? [])[1]?.trim() ?? "";
      const description =
        (frontmatter.match(/^description:\s*(.*)$/m) ?? [])[1]?.trim() ?? "";
      out.push({
        name: entry.name,
        base,
        present: true,
        frontmatterNameOk: name === entry.name,
        descriptionOk: description.length >= 30,
      });
    }
  }
  return out;
}

function checkMirror() {
  // Static, dependency-free mirror check: every .claude file (minus denied)
  // must exist under .agents with the textual rewrite applied.
  const denied = new Set(["settings.local.json", "scheduled_tasks.lock"]);
  let missing = [];
  let diverged = [];
  const walk = (dir, prefix) => {
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const files = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (denied.has(entry.name)) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) files.push(...walk(join(dir, entry.name), rel));
      else if (entry.isFile()) files.push(rel);
    }
    return files;
  };
  const sourceFiles = walk(join(root, ".claude"), "");
  for (const rel of sourceFiles) {
    const source = safeRead(`.claude/${rel}`);
    const mirrored = safeRead(`.agents/${rel}`);
    if (mirrored === null) {
      missing.push(rel);
      continue;
    }
    if (
      source !== null &&
      mirrored !== source.split(".claude/").join(".agents/")
    ) {
      diverged.push(rel);
    }
  }
  return {
    missing,
    diverged,
    clean: missing.length === 0 && diverged.length === 0,
  };
}

function checkNative() {
  const config = safeRead(".codex/config.toml");
  const implementer = safeRead(".codex/agents/implementer.toml");
  const reviewer = safeRead(".codex/agents/code-reviewer.toml");
  return {
    configPresent: config !== null,
    implementerPresent: implementer !== null,
    reviewerPresent: reviewer !== null,
    reviewerReadOnly:
      reviewer !== null &&
      /shell_tool\s*=\s*false/.test(reviewer) &&
      /memories\s*=\s*false/.test(reviewer),
    localStateAbsent: !existsSync(join(root, ".codex/settings.local.json")),
  };
}

function hasSecretLeak(text) {
  return (
    /sk-[A-Za-z0-9]{8,}/.test(text) ||
    /Bearer\s+[A-Za-z0-9._~+/-]{8,}/i.test(text) ||
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)
  );
}

export function runDoctor() {
  const skills = listSkills();
  const mirror = checkMirror();
  const native = checkNative();
  const declared = {
    skills: skills.filter((s) => s.present).length,
    skillsMissingFrontmatter: skills.filter(
      (s) => s.present && !(s.frontmatterNameOk && s.descriptionOk),
    ).length,
    mirrorClean: mirror.clean,
    nativeConfigPresent: native.configPresent,
    nativeRolesPresent: native.implementerPresent && native.reviewerPresent,
    reviewerReadOnly: native.reviewerReadOnly,
    localStateAbsent: native.localStateAbsent,
  };
  const report = {
    version: 1,
    declared,
    effectiveLoaded: "unverified",
    observedExecution: "unverified",
    details: {
      mirrorMissing: mirror.missing.slice(0, 10),
      mirrorDiverged: mirror.diverged.slice(0, 10),
    },
    notes: [
      "effective loaded configuration requires a client session; not observable from files",
      "observed execution requires a client run; reported as unverified, never success",
    ],
  };
  const serialized = JSON.stringify(report, null, 2);
  if (hasSecretLeak(serialized))
    throw new Error("doctor output contains secret-like content");
  return report;
}

const args = process.argv.slice(2);
if (args.includes("--json") || !args.includes("--no-run")) {
  if (process.argv[1] && process.argv[1].endsWith("agent-doctor.mjs")) {
    const report = runDoctor();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (args.includes("--strict")) {
      const ok =
        report.declared.mirrorClean &&
        report.declared.nativeConfigPresent &&
        report.declared.nativeRolesPresent &&
        report.declared.reviewerReadOnly &&
        report.declared.localStateAbsent &&
        report.declared.skillsMissingFrontmatter === 0;
      process.exit(ok ? 0 : 2);
    }
  }
}
