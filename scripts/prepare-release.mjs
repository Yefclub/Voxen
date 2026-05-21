#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const bump = process.argv[2];
const allowed = new Set(['patch', 'minor', 'major']);

if (!allowed.has(bump)) {
  console.error('Uso: pnpm release:prepare <patch|minor|major>');
  process.exit(2);
}

const versionFiles = ['package.json', 'apps/web/package.json'];

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function parseStable(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return null;
  return match.slice(1).map(Number);
}

function compareSemverDesc(a, b) {
  const av = parseStable(a);
  const bv = parseStable(b);
  for (let i = 0; i < 3; i += 1) {
    if (av[i] !== bv[i]) return bv[i] - av[i];
  }
  return 0;
}

function bumpVersion(version, kind) {
  const next = [...version];
  if (kind === 'major') {
    next[0] += 1;
    next[1] = 0;
    next[2] = 0;
  } else if (kind === 'minor') {
    next[1] += 1;
    next[2] = 0;
  } else {
    next[2] += 1;
  }
  return next.join('.');
}

const tags = git(['tag', '--list', 'v*'])
  .split('\n')
  .map((tag) => tag.trim())
  .filter(Boolean)
  .filter((tag) => parseStable(tag));

let base = tags.sort(compareSemverDesc)[0]?.replace(/^v/, '');

if (!base) {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  base = String(pkg.version).split('-')[0];
}

const parsedBase = parseStable(base);
if (!parsedBase) {
  console.error(`Versão base inválida: ${base}`);
  process.exit(1);
}

const next = bumpVersion(parsedBase, bump);

for (const file of versionFiles) {
  const json = JSON.parse(readFileSync(file, 'utf8'));
  json.version = next;
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}

console.log(`Release preparada: ${base} -> ${next} (${bump})`);
console.log('');
console.log('Próximos passos sugeridos:');
console.log(`  git checkout -b release/v${next}   # se ainda não estiver numa branch de release`);
console.log('  git add package.json apps/web/package.json');
console.log(`  git commit -m "chore: release v${next}"`);
console.log(`  gh pr create --base main --label release:${bump} --title "release: v${next}"`);
