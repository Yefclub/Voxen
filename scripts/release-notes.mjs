#!/usr/bin/env node
// release-notes.mjs — pipeline de changelog (changeset → releases.json + CHANGELOG.md)
// Port do padrão Orbital/workflows, adaptado ao Voxen (sem deps externas).
//
// Modos:
//   add-dev        RN_SOURCE, RN_VERSION, RN_PR?, RN_AUTHOR?, RN_DATE?
//   prod           RN_VERSION, RN_DATE?, RN_PR?
//   check          RN_SOURCE
//   changelog      regenera CHANGELOG.md
//   merge-keep-dev RN_OURS (path)

import fs from 'node:fs';

const FILE = process.env.RN_FILE || 'releases.json';
const CHANGELOG = process.env.RN_CHANGELOG || 'CHANGELOG.md';
const TYPES = ['feat', 'fix', 'perf', 'ui', 'infra', 'security', 'chore'];
const TYPE_META = {
  feat: { label: 'Novidades', emoji: '✨' },
  fix: { label: 'Correções', emoji: '🐛' },
  perf: { label: 'Performance', emoji: '⚡' },
  ui: { label: 'UI/UX', emoji: '🎨' },
  infra: { label: 'Infra/DevOps', emoji: '🛠️' },
  security: { label: 'Segurança', emoji: '🔒' },
  chore: { label: 'Manutenção', emoji: '🧹' },
};

function load(path = FILE) {
  try {
    const data = JSON.parse(fs.readFileSync(path, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function loadStrict(path = FILE) {
  let raw;
  try {
    raw = fs.readFileSync(path, 'utf8');
  } catch {
    throw new Error(`[changelog] não consegui ler ${path}; promoção cancelada.`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`[changelog] ${path} contém JSON inválido; promoção cancelada.`);
  }
  if (!Array.isArray(data)) {
    throw new Error(`[changelog] ${path} precisa conter uma lista; promoção cancelada.`);
  }
  return data;
}

function save(entries) {
  fs.writeFileSync(FILE, JSON.stringify(entries, null, 2) + '\n');
}

function summary(line) {
  const p = process.env.GITHUB_STEP_SUMMARY;
  if (!p) return;
  try {
    fs.appendFileSync(p, line + '\n');
  } catch {
    /* best-effort */
  }
}

/** @returns {{ type: string, title: string, body: string } | null} */
export function parseChangelogFile(text) {
  const s = String(text || '').slice(0, 50000);
  const m = s.match(/^﻿?\s*---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n([\s\S]*)$/);
  if (!m) return null;
  const fm = m[1];
  const body = m[2].trim();
  const typeM = fm.match(/^[ \t]*tipo[ \t]*:[ \t]*([a-zA-Z]+)/m);
  const titleM = fm.match(/^[ \t]*t[ií]tulo[ \t]*:[ \t]*(.+?)[ \t]*$/m);
  let type = (typeM?.[1] || '').toLowerCase().trim();
  if (!TYPES.includes(type)) type = 'chore';
  const title = (titleM?.[1] || '').replace(/^["']|["']$/g, '').trim();
  if (!title || !body) return null;
  return { type, title, body };
}

function genChangelog(entries) {
  const lines = ['# Changelog', ''];
  for (const e of entries) {
    const date = (e.date || '').slice(0, 10);
    const tag = e.channel === 'prod' ? 'Produção' : 'Dev';
    lines.push(`## v${e.version} — ${date} · ${tag}`, '');
    if (e.channel === 'prod') {
      if (e.body && e.body.trim()) {
        if (e.title && e.title.trim()) lines.push(`### ${e.title.trim()}`, '');
        lines.push(e.body.trim(), '');
      } else {
        for (const p of e.promoted || []) {
          const meta = TYPE_META[p.type] || TYPE_META.chore;
          lines.push(`### ${meta.emoji} ${p.title || meta.label}`, '');
          lines.push((p.body || p.summary || '').trim(), '');
        }
      }
    } else {
      const meta = TYPE_META[e.type] || TYPE_META.chore;
      lines.push(`### ${meta.emoji} ${e.title || meta.label}`, '');
      lines.push((e.body || e.summary || '').trim(), '');
    }
  }
  fs.writeFileSync(
    CHANGELOG,
    lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '\n'),
  );
}

function addDev() {
  const version = process.env.RN_VERSION;
  const source = process.env.RN_SOURCE;
  if (!version || !source) {
    console.error('[changelog] RN_VERSION/RN_SOURCE ausente — pulando.');
    return false;
  }
  let note;
  try {
    note = parseChangelogFile(fs.readFileSync(source, 'utf8'));
  } catch {
    console.error(`[changelog] não consegui ler ${source} — pulando.`);
    return false;
  }
  if (!note) {
    console.error(`[changelog] ${source} inválido (frontmatter/corpo) — pulando.`);
    return false;
  }
  const entries = load();
  const entry = {
    version,
    channel: 'dev',
    type: note.type,
    title: note.title,
    body: note.body,
    pr: process.env.RN_PR ? Number(process.env.RN_PR) : null,
    author: process.env.RN_AUTHOR || null,
    date: process.env.RN_DATE || new Date().toISOString(),
  };
  if (entry.pr && process.env.RN_REPO_URL) {
    entry.prUrl = `${process.env.RN_REPO_URL.replace(/\/+$/, '')}/pull/${entry.pr}`;
  }
  entries.unshift(entry);
  save(entries);
  genChangelog(entries);
  console.log(`[changelog] dev: +1 (${note.type}) v${version} — ${note.title}`);
  return true;
}

function addProd() {
  const version = process.env.RN_VERSION;
  if (!version) {
    console.error('[changelog] RN_VERSION ausente — pulando.');
    return false;
  }
  let entries;
  try {
    entries = loadStrict();
  } catch (error) {
    console.error(error instanceof Error ? error.message : '[changelog] promoção cancelada.');
    return false;
  }
  const entriesWithoutCurrentVersion = entries.filter(
    (entry) => !(entry.channel === 'prod' && entry.version === version),
  );
  const promoted = [];
  for (const e of entriesWithoutCurrentVersion) {
    if (e.channel === 'prod') break;
    if (e.channel === 'dev') {
      promoted.unshift({
        type: e.type,
        title: e.title || e.summary || '',
        body: e.body || e.summary || '',
        pr: e.pr,
        ...(e.prUrl ? { prUrl: e.prUrl } : {}),
      });
    }
  }
  const RELEASE_FILE = 'changelog/RELEASE.md';
  let curated = null;
  try {
    if (fs.existsSync(RELEASE_FILE)) {
      curated = parseChangelogFile(fs.readFileSync(RELEASE_FILE, 'utf8'));
    }
  } catch {
    curated = null;
  }
  const entry = {
    version,
    channel: 'prod',
    date: process.env.RN_DATE || new Date().toISOString(),
    promoted,
  };
  if (process.env.RN_PR) {
    entry.pr = Number(process.env.RN_PR);
    if (entry.pr && process.env.RN_REPO_URL) {
      entry.prUrl = `${process.env.RN_REPO_URL.replace(/\/+$/, '')}/pull/${entry.pr}`;
    }
  }
  if (curated) {
    entry.title = curated.title;
    entry.body = curated.body;
  }
  const nextEntries = [entry, ...entriesWithoutCurrentVersion];
  save(nextEntries);
  genChangelog(nextEntries);
  const msg = `prod: v${version} ${curated ? '(curado) ' : ''}agregou ${promoted.length} mudança(s)`;
  console.log(`[changelog] ${msg}`);
  summary(`- **release notes** — ${msg}`);
  return true;
}

function mergeKeepDev() {
  const oursPath = process.env.RN_OURS;
  if (!oursPath || !fs.existsSync(oursPath)) {
    console.log('[changelog] merge-keep-dev: RN_OURS ausente — nada a preservar.');
    return true;
  }
  const main = load();
  const ours = load(oursPath);
  const key = (e) => `${e.channel}|${e.version}|${e.pr ?? ''}|${e.title ?? ''}`;
  const known = new Set(main.map(key));
  const devOnly = ours.filter((e) => e.channel === 'dev' && !known.has(key(e)));
  if (devOnly.length === 0) {
    console.log('[changelog] merge-keep-dev: nenhuma entrada dev a preservar.');
    return true;
  }
  save([...devOnly, ...main]);
  genChangelog([...devOnly, ...main]);
  console.log(`[changelog] merge-keep-dev: preservou ${devOnly.length} entrada(s) dev pós-corte`);
  return true;
}

const mode = process.argv[2];
if (mode === 'add-dev') {
  if (!addDev()) process.exit(1);
} else if (mode === 'prod') {
  if (!addProd()) process.exit(1);
} else if (mode === 'merge-keep-dev') {
  if (!mergeKeepDev()) process.exit(1);
} else if (mode === 'changelog') {
  genChangelog(load());
} else if (mode === 'check') {
  const source = process.env.RN_SOURCE;
  let note = null;
  try {
    note = source ? parseChangelogFile(fs.readFileSync(source, 'utf8')) : null;
  } catch {
    note = null;
  }
  if (!note) {
    console.error(
      `[changelog] arquivo inválido: ${source || '(vazio)'} — precisa de frontmatter "tipo" + "titulo" e corpo markdown.`,
    );
    process.exit(1);
  }
  console.log(`[changelog] OK: ${note.type} — ${note.title}`);
} else if (mode) {
  console.error(`[changelog] modo inválido: ${mode}`);
  process.exit(1);
}
