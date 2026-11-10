import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Returns the indented block of a top-level Compose service, without comments. */
function serviceBlock(raw, name) {
  const compose = stripComments(raw);
  const start = compose.indexOf(`\n  ${name}:\n`);
  assert.notEqual(start, -1, `service ${name} exists`);
  const rest = compose.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z0-9-]+:\n|\n[a-z]/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

function stripComments(text) {
  return text
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .map((line) => line.replace(/\s+#.*$/, ""))
    .join("\n");
}

function networkBlock(raw, name) {
  const compose = stripComments(raw);
  const networks = compose.slice(compose.search(/\nnetworks:\n/));
  const start = networks.indexOf(`\n  ${name}:\n`);
  assert.notEqual(start, -1, `network ${name} exists`);
  const rest = networks.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z0-9-]+:\n|\n[a-z]/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

test("stt-net is internal and shared only by web and stt-local (spec 221)", async () => {
  const compose = await readFile(join(repoRoot, "docker-compose.yml"), "utf8");
  assert.match(networkBlock(compose, "stt-net"), /internal:\s*true/);
  const stt = serviceBlock(compose, "stt-local");
  assert.match(stt, /stt-net/);
  assert.doesNotMatch(stt, /voxen-net/, "stt-local must not join voxen-net");
  assert.match(serviceBlock(compose, "web"), /stt-net/);
  assert.doesNotMatch(serviceBlock(compose, "capture-worker"), /stt-net/);
  const clean = stripComments(compose);
  const services = clean.slice(clean.search(/\nservices:\n/), clean.search(/\nnetworks:\n/));
  const names = [...services.matchAll(/\n {2}([a-z0-9-]+):\n/g)].map((match) => match[1]);
  assert.ok(names.includes("capture-worker") && names.length > 3, "service list parsed");
  for (const name of names.filter((n) => n !== "web" && n !== "stt-local")) {
    assert.doesNotMatch(serviceBlock(compose, name), /stt-net/, `${name} stays off stt-net`);
  }
});

test("stt-local publishes no ports and keeps its hardening (spec 221)", async () => {
  const compose = await readFile(join(repoRoot, "docker-compose.yml"), "utf8");
  const stt = serviceBlock(compose, "stt-local");
  assert.doesNotMatch(stt, /\n\s+ports:/);
  assert.match(stt, /read_only:\s*true/);
  assert.match(stt, /cap_drop:[\s\S]*ALL/);
  assert.match(stt, /no-new-privileges:true/);
  assert.match(stt, /mem_limit:/);
  assert.match(stt, /profiles:\s*\[\s*stt-local\s*\]/);
});
