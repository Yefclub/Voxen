import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

test("README owns and renders both product covers", () => {
  const readme = read("README.md");
  for (const asset of [
    "docs/assets/voxen-library.png",
    "docs/assets/voxen-chat.png",
  ]) {
    assert.equal(existsSync(resolve(root, asset)), true, `${asset} is missing`);
    assert.match(readme, new RegExp(`!\\[[^\\]]+\\]\\(${asset}\\)`));
  }
});

test("current public documentation does not describe the removed chat service", () => {
  const currentRuntimeDocs = [
    "CLAUDE.md",
    "docs/ARCHITECTURE.md",
    "docs/DEVELOPMENT.md",
    "docs/README.md",
    "docs/SECURITY.md",
    "docs/STACK.md",
    "docs/TRANSCRIPT-FORMAT.md",
    "docs/en/ARCHITECTURE.md",
    "docs/en/DEVELOPMENT.md",
    "docs/en/README.md",
    "docs/en/SECURITY.md",
    "docs/en/STACK.md",
    "docs/en/TRANSCRIPT-FORMAT.md",
  ];

  for (const path of currentRuntimeDocs) {
    const content = read(path);
    assert.doesNotMatch(
      content,
      /apps\/chat/,
      `${path} still references apps/chat`,
    );
    assert.doesNotMatch(
      content,
      /FastAPI|Agno/,
      `${path} still presents the retired Python agent stack`,
    );
  }

  const dependabot = read(".github/dependabot.yml");
  assert.doesNotMatch(dependabot, /directory:\s*\/apps\/chat/);
  assert.match(read("docs/en/DECISIONS.md"), /ADR-003:.*superseded/i);
  assert.match(read("docs/DECISIONS.md"), /ADR-003.*substitu/i);
});

test("known patched dependency versions are selected", () => {
  const web = JSON.parse(read("apps/web/package.json"));
  const workspace = JSON.parse(read("package.json"));
  const lock = read("pnpm-lock.yaml");

  assert.match(web.dependencies.hono, /4\.(?:1[3-9]|[2-9]\d)\./);
  assert.match(
    web.dependencies["@hono/node-server"],
    /\^(?:2\.(?:[1-9]|\d{2,})|[3-9]\.)/,
  );
  assert.match(
    web.dependencies["@modelcontextprotocol/sdk"],
    /\^1\.(?:3[0-9]|[4-9]\d)\./,
  );
  assert.match(workspace.pnpm.overrides.postcss, /8\.5\.(?:2[3-9]|[3-9]\d)/);

  for (const vulnerable of [
    "brace-expansion@1.1.14",
    "brace-expansion@2.1.1",
    "dompurify@3.4.11",
    "mermaid@11.15.0",
    "postcss@8.5.18",
    "hono@4.12.25",
    "@hono/node-server@1.19.14",
  ]) {
    assert.equal(
      lock.includes(vulnerable),
      false,
      `${vulnerable} remains locked`,
    );
  }
});

test("repository policy protects an automated open-source squash workflow", () => {
  const settings = JSON.parse(read(".github/repository-settings.json"));

  assert.equal(settings.repository.allow_squash_merge, true);
  assert.equal(settings.repository.allow_merge_commit, false);
  assert.equal(settings.repository.allow_rebase_merge, false);
  assert.equal(settings.repository.delete_branch_on_merge, true);
  assert.equal(settings.repository.has_issues, true);
  assert.equal(settings.repository.has_discussions, true);
  assert.deepEqual(settings.actions, {
    default_workflow_permissions: "read",
    can_approve_pull_request_reviews: true,
  });
  assert.equal(settings.topics.includes("fastapi"), false);
  for (const topic of ["mcp", "knowledge-graph", "home-lab"]) {
    assert.equal(
      settings.topics.includes(topic),
      true,
      `${topic} topic is missing`,
    );
  }
});

test("local Markdown links resolve to versioned files", () => {
  const documents = [
    "README.md",
    "CODE_OF_CONDUCT.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "SUPPORT.md",
    "docs/README.md",
    "docs/ARCHITECTURE.md",
    "docs/DECISIONS.md",
    "docs/DEPLOY.md",
    "docs/DEVELOPMENT.md",
    "docs/SECURITY.md",
    "docs/STACK.md",
    "docs/TRANSCRIPT-FORMAT.md",
    "docs/en/README.md",
    "docs/en/ARCHITECTURE.md",
    "docs/en/DECISIONS.md",
    "docs/en/DEPLOY.md",
    "docs/en/DEVELOPMENT.md",
    "docs/en/SECURITY.md",
    "docs/en/STACK.md",
    "docs/en/TRANSCRIPT-FORMAT.md",
  ];
  const failures = [];
  const linkPattern = /!?\[[^\]]*\]\(([^)]+)\)/g;

  for (const document of documents) {
    const content = read(document)
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`[^`\n]*`/g, "");
    for (const match of content.matchAll(linkPattern)) {
      const raw = match[1].trim().replace(/^<|>$/g, "");
      const target = raw.split("#", 1)[0].split("?", 1)[0];
      if (
        target === "" ||
        target.startsWith("#") ||
        /^[a-z][a-z\d+.-]*:/i.test(target)
      ) {
        continue;
      }
      const decoded = decodeURIComponent(target);
      const absolute = resolve(root, dirname(document), decoded);
      if (!existsSync(absolute)) failures.push(`${document} -> ${target}`);
    }
  }

  assert.deepEqual(failures, []);
});

test("README cover assets are valid, reviewable PNG files", () => {
  for (const asset of [
    "docs/assets/voxen-library.png",
    "docs/assets/voxen-chat.png",
  ]) {
    const absolute = resolve(root, asset);
    const bytes = readFileSync(absolute);
    const { size } = statSync(absolute);

    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(bytes.subarray(12, 16).toString("ascii"), "IHDR");

    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    assert.ok(width >= 1200 && width <= 3000, `${asset} width is ${width}`);
    assert.ok(height >= 700 && height <= 2000, `${asset} height is ${height}`);
    assert.ok(size >= 50_000 && size <= 2_000_000, `${asset} size is ${size}`);
  }
});
