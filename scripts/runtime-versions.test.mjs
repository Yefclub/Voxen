import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function parts(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  assert.ok(match, `unparseable version: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function atLeast(version, floor) {
  const [a, b, c] = parts(version);
  const [x, y, z] = parts(floor);
  return a !== x ? a > x : b !== y ? b > y : c >= z;
}

// CVE-2026-111497 (Brotli): Node 22.x needs >= 22.23.4 per line,
// Bun needs >= 1.4.4. A floating tag or an older minor line must fail here
// instead of passing because a base name "looks current".
test("docker stages select patched Node.js and Bun releases", () => {
  for (const file of ["Dockerfile", "apps/web/Dockerfile"]) {
    const content = read(file);
    assert.ok(
      !/(oven\/bun:1\.[0-3]\b|oven\/bun:1\.3-)/.test(content),
      `${file} pins an old Bun line`,
    );
    assert.ok(
      !/node:22(-alpine|-bookworm-slim)?( |$)/m.test(content),
      `${file} uses a floating Node 22 tag`,
    );
    for (const match of content.matchAll(/^FROM\s+node:(\S+)\s+AS\s+(\S+)/gm)) {
      assert.ok(
        atLeast(match[1], "22.23.4"),
        `${file} stage ${match[2]} uses node ${match[1]}`,
      );
    }
    for (const match of content.matchAll(
      /^FROM\s+(oven\/bun:\S+)\s+AS\s+(\S+)/gm,
    )) {
      const version = match[1].replace("oven/bun:", "").replace("-alpine", "");
      assert.ok(
        atLeast(version, "1.4.4"),
        `${file} stage ${match[2]} uses ${match[1]}`,
      );
    }
  }
});

test("CI jobs and engines agree with the patched runtime floor", () => {
  for (const file of [
    ".github/workflows/ci.yml",
    ".github/workflows/security.yml",
  ]) {
    const content = read(file);
    assert.ok(
      !/bun-version:\s*1\.2\.x/.test(content),
      `${file} still selects Bun 1.2.x`,
    );
    assert.ok(
      !/node-version:\s*"22"/.test(content),
      `${file} still selects floating Node 22`,
    );
    for (const match of content.matchAll(/bun-version:\s*(\S+)/g)) {
      assert.ok(atLeast(match[1], "1.4.4"), `${file} selects bun ${match[1]}`);
    }
    for (const match of content.matchAll(/node-version:\s*"([^"]+)"/g)) {
      assert.ok(
        atLeast(match[1], "22.23.4"),
        `${file} selects node ${match[1]}`,
      );
    }
  }
  const engines = JSON.parse(read("package.json")).engines;
  assert.ok(
    atLeast(engines.bun.replace(">=", ""), "1.4.4"),
    `engines.bun is ${engines.bun}`,
  );
  assert.ok(
    atLeast(engines.node.replace(">=", ""), "22.23.4"),
    `engines.node is ${engines.node}`,
  );
});
