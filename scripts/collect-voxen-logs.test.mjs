import assert from "node:assert/strict";
import test from "node:test";

import {
  collectStructuredLogs,
  parseSince,
  parseStructuredLogLine,
} from "./collect-voxen-logs.mjs";

const web = {
  timestamp: "2026-08-15T12:00:00.000Z",
  level: "error",
  service: "voxen-web",
  event: "job-notify-failed",
  job_id: "job-1",
  request_id: "request-1",
  error_code: "JOB_NOTIFY_FAILED",
};

test("parses JSON after a Docker or Easypanel log prefix", () => {
  assert.deepEqual(
    parseStructuredLogLine(`voxen-app.1 | ${JSON.stringify(web)}`),
    web,
  );
  assert.equal(
    parseStructuredLogLine("plain legacy log with secret-looking text"),
    null,
  );
  assert.equal(parseStructuredLogLine('{"service":"unknown"}'), null);
});

test("filters safe structured fields and summarizes matching failures", () => {
  const worker = {
    timestamp: "2026-08-15T12:01:00.000Z",
    level: "info",
    service: "voxen-worker",
    event: "job-done",
    job_id: "job-2",
  };
  const input = [
    JSON.stringify(web),
    `prefix | ${JSON.stringify(worker)}`,
    "unstructured",
  ].join("\n");

  const result = collectStructuredLogs(input, {
    filters: { job_id: "job-1", error_code: "JOB_NOTIFY_FAILED" },
  });

  assert.deepEqual(result.events, [web]);
  assert.deepEqual(result.summary, {
    parsed: 2,
    matched: 1,
    byLevel: { error: 1 },
    byErrorCode: { JOB_NOTIFY_FAILED: 1 },
  });
});

test("supports bounded relative and ISO timestamps", () => {
  const now = Date.parse("2026-08-15T12:00:00.000Z");
  assert.equal(parseSince("30m", now), now - 30 * 60_000);
  assert.equal(
    parseSince("2026-08-15T10:00:00Z", now),
    Date.parse("2026-08-15T10:00:00Z"),
  );
  assert.throws(() => parseSince("forever", now), /Invalid --since/);
});
