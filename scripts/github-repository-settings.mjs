#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const settingsUrl = new URL(
  '../.github/repository-settings.json',
  import.meta.url,
);

export function repositorySettingsDiff(expected, actual) {
  return Object.entries(expected)
    .filter(([key, value]) => actual[key] !== value)
    .map(([key, value]) => ({ key, expected: value, actual: actual[key] }));
}

export function patchArguments(expected) {
  const args = ['api', '--method', 'PATCH', `repos/${repositoryName()}`];
  for (const [key, value] of Object.entries(expected)) {
    args.push(typeof value === 'boolean' ? '-F' : '-f', `${key}=${value}`);
  }
  return args;
}

function repositoryName() {
  return process.env.GITHUB_REPOSITORY || 'Yefclub/Voxen';
}

function gh(args) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

function readExpected() {
  const parsed = JSON.parse(readFileSync(settingsUrl, 'utf8'));
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('.github/repository-settings.json must contain an object');
  }
  return parsed;
}

function readActual() {
  return JSON.parse(gh(['api', `repos/${repositoryName()}`]));
}

function main() {
  const apply = process.argv.includes('--apply');
  const unknown = process.argv.slice(2).filter((arg) => arg !== '--apply');
  if (unknown.length > 0) {
    console.error(`Unknown argument: ${unknown.join(' ')}`);
    process.exit(2);
  }

  const expected = readExpected();
  let diff = repositorySettingsDiff(expected, readActual());

  if (diff.length === 0) {
    console.log(
      `GitHub repository settings are synchronized for ${repositoryName()}.`,
    );
    return;
  }

  for (const item of diff) {
    console.error(
      `${item.key}: expected ${JSON.stringify(item.expected)}, got ${JSON.stringify(item.actual)}`,
    );
  }

  if (!apply) {
    console.error('Run `pnpm github:settings --apply` to synchronize them.');
    process.exit(1);
  }

  gh(patchArguments(expected));
  diff = repositorySettingsDiff(expected, readActual());
  if (diff.length > 0) {
    throw new Error(
      'GitHub accepted the update but repository settings still differ',
    );
  }
  console.log(`GitHub repository settings updated for ${repositoryName()}.`);
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
