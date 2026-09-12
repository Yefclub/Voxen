type LogLevel = 'debug' | 'info' | 'warning' | 'error';
type LogValue = string | number | boolean | null | undefined;

const CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const FIELD_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const BLOCKED_FIELD =
  /(authorization|body|cookie|credential|message|password|payload|secret|token)/i;
const BUILD_ID = /^[A-Za-z0-9._+-]{1,128}$/;

export function validCorrelationId(value: string | null | undefined): string | null {
  const candidate = value?.trim() ?? '';
  return CORRELATION_ID.test(candidate) ? candidate : null;
}

export function buildStructuredLogEvent(
  level: LogLevel,
  event: string,
  fields: Record<string, LogValue> = {},
  now = new Date(),
): Record<string, string | number | boolean | null> {
  const result: Record<string, string | number | boolean | null> = {
    timestamp: now.toISOString(),
    level,
    service: 'voxen-web',
    event: /^[a-z0-9][a-z0-9-]{0,95}$/.test(event) ? event : 'invalid-log-event',
  };
  const version = process.env.VOXEN_VERSION?.trim() ?? '';
  const gitSha = (process.env.VOXEN_GIT_SHA || process.env.GIT_SHA || '').trim();
  if (BUILD_ID.test(version)) result.version = version;
  if (BUILD_ID.test(gitSha)) result.git_sha = gitSha;

  for (const [key, raw] of Object.entries(fields)) {
    if (!FIELD_NAME.test(key) || BLOCKED_FIELD.test(key) || raw === undefined) continue;
    if (typeof raw === 'string') {
      result[key] = raw.replace(/[\r\n\t]/g, ' ').slice(0, 512);
    } else if (typeof raw === 'number' && Number.isFinite(raw)) {
      result[key] = raw;
    } else if (typeof raw === 'boolean' || raw === null) {
      result[key] = raw;
    }
  }
  return result;
}

export function structuredLog(
  level: LogLevel,
  event: string,
  fields: Record<string, LogValue> = {},
): void {
  const line = `${JSON.stringify(buildStructuredLogEvent(level, event, fields))}\n`;
  if (level === 'error' || level === 'warning') process.stderr.write(line);
  else process.stdout.write(line);
}

export function structuredDiagnostic(
  level: 'warning' | 'error',
  event: string,
  errorCode: string,
  error: unknown,
  fields: Record<string, LogValue> = {},
): void {
  structuredLog(level, event, { ...fields, ...safeErrorDiagnostic(errorCode, error) });
}
import { safeErrorDiagnostic } from './safe-diagnostics';
