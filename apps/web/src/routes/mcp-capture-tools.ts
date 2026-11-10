import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { CAPTURE_ERROR_CODES, describeCaptureError } from '../lib/capture/errors';
import { cancelCapture, JOB_SELECT, locale, readJob, serializeJob } from '../lib/capture/jobs';
import { CAPTURE_TYPES, submitCaptureUrl, submitRateLimited } from '../lib/capture/submit';
import { db } from '../lib/db';
import { decodeMcpPageCursor, encodeMcpPageCursor } from './mcp-page-cursor';
import { fail, ok } from './mcp-tool-helpers';

const CAPTURE_SCHEMA = z.object({
  id: z.string(),
  kind: z.enum(['link', 'upload']),
  status: z.string(),
  sourceUrl: z.string().nullable(),
  platform: z.string().nullable(),
  warnings: z.array(z.string()),
  stage: z.string().nullable(),
  percent: z.number().nullable(),
  queuedAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  costUsd: z.number().nullable(),
  transcript: z.object({ id: z.string(), title: z.string().nullable() }).nullable(),
  error: z
    .object({
      code: z.enum(CAPTURE_ERROR_CODES),
      message: z.string(),
      action: z.string(),
      retryable: z.boolean(),
    })
    .nullable(),
});
const CAPTURE_ID = { capture_id: z.string().trim().min(1).max(256).describe('Capture job ID.') };

export function registerMcpCaptureReadTools(server: McpServer, userId: string): void {
  server.registerTool(
    'voxen_capture_status',
    {
      title: 'Capture status',
      description:
        'Read capture stage, percent, warnings and public errors. Poll after voxen_capture_url; ' +
        'when DONE or COMPLETED_WITH_WARNINGS, use transcript.id with voxen_outline and the reading tools.',
      inputSchema: CAPTURE_ID,
      outputSchema: { capture: CAPTURE_SCHEMA },
    },
    async (args) => {
      const job = await readJob(userId, args.capture_id);
      if (!job) return fail('Capture not found.');
      return ok({ capture: serializeJob(job, await locale()) });
    },
  );

  server.registerTool(
    'voxen_list_captures',
    {
      title: 'List captures',
      description:
        'List your recent link and upload captures, newest first. Use nextCursor to continue; ' +
        'hasMore=false means enumeration is complete.',
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe('Page size; default 20, maximum 50.'),
        cursor: z
          .string()
          .max(2048)
          .optional()
          .describe('Opaque nextCursor from the previous page.'),
      },
      outputSchema: {
        captures: z.array(CAPTURE_SCHEMA),
        nextCursor: z.string().nullable(),
        hasMore: z.boolean(),
      },
    },
    async (args) => {
      const context = { userId, tool: 'captures' as const };
      const cursor = decodeMcpPageCursor(args.cursor, context);
      if (!cursor.valid) return fail('Invalid capture cursor. Restart without cursor.');
      const position = cursor.position;
      const limit = args.limit ?? 20;
      const rows = await db.job.findMany({
        where: {
          userId,
          type: { in: [...CAPTURE_TYPES] },
          ...(position
            ? {
                OR: [
                  { queuedAt: { lt: position.createdAt } },
                  { queuedAt: position.createdAt, id: { lt: position.id } },
                ],
              }
            : {}),
        },
        select: JOB_SELECT,
        orderBy: [{ queuedAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
      const lang = await locale();
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      const hasMore = rows.length > limit;
      return ok({
        captures: page.map((job) => serializeJob(job, lang)),
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeMcpPageCursor({ createdAt: last.queuedAt, id: last.id }, context)
            : null,
      });
    },
  );
}

export function registerMcpCaptureWriteTools(server: McpServer, userId: string): void {
  server.registerTool(
    'voxen_capture_url',
    {
      title: 'Capture a link into the knowledge base',
      description:
        'Submit an http(s) link for asynchronous extraction and AI analysis into your knowledge base. ' +
        'Uses your configured AI providers and may incur provider charges. Shares the app/PWA limit ' +
        'of 30 submissions per minute. Returns an existing document or a job to poll with ' +
        'voxen_capture_status; submission is not completion. No file upload.',
      inputSchema: { url: z.string().max(4096).describe('Full http(s) link to capture.') },
      outputSchema: {
        existing: z.boolean(),
        transcript: z.object({ id: z.string(), title: z.string() }).nullable(),
        job: CAPTURE_SCHEMA.nullable(),
        deduped: z.boolean(),
        nextTool: z.enum(['voxen_capture_status', 'voxen_outline']),
      },
    },
    async (args) => {
      const lang = await locale();
      if (await submitRateLimited(userId)) {
        return fail(
          JSON.stringify({
            ...describeCaptureError('RATE_LIMITED', lang),
            message:
              lang === 'en'
                ? 'Too many captures. Wait one minute.'
                : 'Muitas capturas em sequência. Aguarde um minuto.',
            retryAfterSeconds: 60,
          }),
        );
      }
      const outcome = await submitCaptureUrl(userId, args.url);
      if (outcome.kind === 'error') {
        return fail(
          JSON.stringify({
            ...describeCaptureError(outcome.code, lang),
            ...(outcome.code === 'AI_NOT_CONFIGURED' ? { settingsUrl: '/conta/ia' } : {}),
          }),
        );
      }
      if (outcome.kind === 'existing') {
        return ok({
          existing: true,
          transcript: { id: outcome.transcriptId, title: outcome.title },
          job: null,
          deduped: false,
          nextTool: 'voxen_outline',
        });
      }
      const job = await readJob(userId, outcome.jobId);
      if (!job) return fail('Capture no longer exists. List captures before submitting again.');
      return ok({
        existing: false,
        transcript: null,
        job: serializeJob(job, lang),
        deduped: outcome.deduped,
        nextTool: 'voxen_capture_status',
      });
    },
  );

  server.registerTool(
    'voxen_cancel_capture',
    {
      title: 'Cancel a capture',
      description:
        'Cancel an active capture using the same cancellation as the app. ' +
        'A terminal capture is returned unchanged with alreadyFinished=true.',
      inputSchema: CAPTURE_ID,
      outputSchema: { capture: CAPTURE_SCHEMA, alreadyFinished: z.boolean() },
    },
    async (args) => {
      const lang = await locale();
      const result = await cancelCapture(userId, args.capture_id, lang);
      if (!result.job) return fail('Capture not found.');
      return ok({
        capture: serializeJob(result.job, lang),
        alreadyFinished: result.alreadyFinished,
      });
    },
  );
}
