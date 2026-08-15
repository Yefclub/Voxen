#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const FILTERS = new Map([
  ["--service", "service"],
  ["--level", "level"],
  ["--event", "event"],
  ["--job", "job_id"],
  ["--request", "request_id"],
  ["--error-code", "error_code"],
]);

export function parseStructuredLogLine(line) {
  const start = line.indexOf("{");
  if (start < 0) return null;
  try {
    const parsed = JSON.parse(line.slice(start));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return null;
    if (!["voxen-web", "voxen-worker"].includes(parsed.service)) return null;
    if (typeof parsed.event !== "string" || typeof parsed.level !== "string")
      return null;
    if (
      typeof parsed.timestamp !== "string" ||
      Number.isNaN(Date.parse(parsed.timestamp))
    )
      return null;
    return parsed;
  } catch {
    return null;
  }
}

export function parseSince(value, now = Date.now()) {
  if (!value) return null;
  const duration = /^(\d+)([mhd])$/.exec(value);
  if (duration) {
    const amount = Number(duration[1]);
    const unitMs = { m: 60_000, h: 3_600_000, d: 86_400_000 }[duration[2]];
    return now - amount * unitMs;
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp))
    throw new Error(`Invalid --since value: ${value}`);
  return timestamp;
}

export function collectStructuredLogs(text, options = {}, now = Date.now()) {
  const since = parseSince(options.since, now);
  const events = [];
  let parsedCount = 0;
  for (const line of text.split(/\r?\n/)) {
    const event = parseStructuredLogLine(line);
    if (!event) continue;
    parsedCount += 1;
    if (since !== null && Date.parse(event.timestamp) < since) continue;
    if (
      Object.entries(options.filters ?? {}).some(
        ([field, expected]) => String(event[field] ?? "") !== expected,
      )
    ) {
      continue;
    }
    events.push(event);
  }
  const byLevel = {};
  const byErrorCode = {};
  for (const event of events) {
    byLevel[event.level] = (byLevel[event.level] ?? 0) + 1;
    if (event.error_code) {
      byErrorCode[event.error_code] = (byErrorCode[event.error_code] ?? 0) + 1;
    }
  }
  return {
    events,
    summary: {
      parsed: parsedCount,
      matched: events.length,
      byLevel,
      byErrorCode,
    },
  };
}

function parseArgs(argv) {
  const options = { filters: {} };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") return { help: true, filters: {} };
    const field = FILTERS.get(argument);
    if (field) {
      const value = argv[++index];
      if (!value) throw new Error(`${argument} requires a value`);
      options.filters[field] = value;
      continue;
    }
    if (argument === "--since" || argument === "--file") {
      const value = argv[++index];
      if (!value) throw new Error(`${argument} requires a value`);
      options[argument.slice(2)] = value;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function usage() {
  return `Usage: docker service logs <service> --since 2h 2>&1 | node scripts/collect-voxen-logs.mjs [filters]

Filters:
  --since 30m|2h|1d|ISO-8601
  --service voxen-web|voxen-worker
  --level debug|info|warning|error
  --event EVENT  --job JOB_ID  --request REQUEST_ID  --error-code CODE
  --file PATH    read copied Easypanel logs instead of stdin
`;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(usage());
      return;
    }
    const input = options.file
      ? readFileSync(options.file, "utf8")
      : readFileSync(0, "utf8");
    const result = collectStructuredLogs(input, options);
    for (const event of result.events)
      process.stdout.write(`${JSON.stringify(event)}\n`);
    process.stderr.write(
      `${JSON.stringify({ type: "voxen-log-summary", ...result.summary })}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Log collection failed"}\n`,
    );
    process.exitCode = 2;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)
  main();
