#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const settingsUrl = new URL(
  "../.github/repository-settings.json",
  import.meta.url,
);

export function settingsDiff(expected, actual) {
  return Object.entries(expected)
    .filter(([key, value]) => actual[key] !== value)
    .map(([key, value]) => ({ key, expected: value, actual: actual[key] }));
}

export function repositorySettingsDiff(expected, actual) {
  return settingsDiff(expected, actual);
}

function typedField(args, key, value) {
  args.push(typeof value === "boolean" ? "-F" : "-f", `${key}=${value}`);
}

export function patchArguments(expected, repository = repositoryName()) {
  const args = ["api", "--method", "PATCH", `repos/${repository}`];
  for (const [key, value] of Object.entries(expected)) {
    typedField(args, key, value);
  }
  return args;
}

export function topicsArguments(topics, repository = repositoryName()) {
  const args = ["api", "--method", "PUT", `repos/${repository}/topics`];
  for (const topic of topics) args.push("-f", `names[]=${topic}`);
  return args;
}

export function actionsArguments(expected, repository = repositoryName()) {
  const args = [
    "api",
    "--method",
    "PUT",
    `repos/${repository}/actions/permissions/workflow`,
  ];
  for (const [key, value] of Object.entries(expected)) {
    typedField(args, key, value);
  }
  return args;
}

function repositoryName() {
  return process.env.GITHUB_REPOSITORY || "Yefclub/Voxen";
}

function gh(args) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

function readExpected() {
  const parsed = JSON.parse(readFileSync(settingsUrl, "utf8"));
  if (
    !parsed?.repository ||
    !Array.isArray(parsed?.topics) ||
    !parsed?.actions
  ) {
    throw new Error(
      ".github/repository-settings.json must define repository, topics, and actions",
    );
  }
  return parsed;
}

function readActual() {
  const repository = repositoryName();
  return {
    repository: JSON.parse(gh(["api", `repos/${repository}`])),
    topics: JSON.parse(gh(["api", `repos/${repository}/topics`])).names,
    actions: JSON.parse(
      gh(["api", `repos/${repository}/actions/permissions/workflow`]),
    ),
  };
}

function allDiffs(expected, actual) {
  return [
    ...settingsDiff(expected.repository, actual.repository).map((item) => ({
      ...item,
      scope: "repository",
    })),
    ...(JSON.stringify(expected.topics) === JSON.stringify(actual.topics)
      ? []
      : [
          {
            scope: "topics",
            key: "names",
            expected: expected.topics,
            actual: actual.topics,
          },
        ]),
    ...settingsDiff(expected.actions, actual.actions).map((item) => ({
      ...item,
      scope: "actions",
    })),
  ];
}

function main() {
  const apply = process.argv.includes("--apply");
  const unknown = process.argv.slice(2).filter((arg) => arg !== "--apply");
  if (unknown.length > 0) {
    console.error(`Unknown argument: ${unknown.join(" ")}`);
    process.exit(2);
  }

  const expected = readExpected();
  let diff = allDiffs(expected, readActual());
  if (diff.length === 0) {
    console.log(
      `GitHub repository settings are synchronized for ${repositoryName()}.`,
    );
    return;
  }

  for (const item of diff) {
    console.error(
      `${item.scope}.${item.key}: expected ${JSON.stringify(item.expected)}, got ${JSON.stringify(item.actual)}`,
    );
  }

  if (!apply) {
    console.error("Run `pnpm github:settings --apply` to synchronize them.");
    process.exit(1);
  }

  const repository = repositoryName();
  gh(patchArguments(expected.repository, repository));
  gh(topicsArguments(expected.topics, repository));
  gh(actionsArguments(expected.actions, repository));
  diff = allDiffs(expected, readActual());
  if (diff.length > 0) {
    throw new Error(
      "GitHub accepted the update but managed repository settings still differ",
    );
  }
  console.log(`GitHub repository settings updated for ${repository}.`);
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
