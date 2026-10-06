import type { McpServer, ToolCallback, ToolAnnotations } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { structuredLog } from '../lib/structured-log';
import { MCP_TOOL_SCOPES, mcpToolAnnotations } from './mcp-tool-policy';
import { type McpConcurrencyLimiter, mcpToolConcurrency } from './mcp-request-protection';
import { budgetMcpResult, McpResultBudgetError, MCP_RESULT_WIRE_BYTES } from './mcp-result-budget';
import { MCP_READ_PAGE_SCHEMA, MCP_WRITE_SUMMARY_SCHEMA } from './mcp-result-schemas';
import { boundedMcpInputShape, validMcpArgumentBudget, MCP_INPUT_LIMITS } from './mcp-input-budget';
import { mcpNormalOutputSchema } from './mcp-output-contracts';
import { fail, ok } from './mcp-tool-helpers';

type Input = z.ZodObject<z.ZodRawShape>;
type ToolConfig = {
  title?: string;
  description?: string;
  inputSchema?: z.ZodRawShape;
  outputSchema?: z.ZodRawShape;
  annotations?: ToolAnnotations;
  _meta?: Record<string, unknown>;
};
type ExecutionIdentity = { userId: string; requestId: string };

/** Apply one execution boundary to every domain registration without weakening its types. */
export function installMcpToolExecution(
  server: McpServer,
  identity: ExecutionIdentity,
  limiter: McpConcurrencyLimiter = mcpToolConcurrency,
): void {
  const original = server.registerTool.bind(server);
  const register = (name: string, config: ToolConfig, callback: ToolCallback<Input>) => {
    if (!Object.hasOwn(MCP_TOOL_SCOPES, name)) throw new Error('MCP tool policy is missing');
    const scope = MCP_TOOL_SCOPES[name as keyof typeof MCP_TOOL_SCOPES];
    const read = scope === 'READ';
    const annotations: ToolAnnotations = {
      ...config.annotations,
      ...mcpToolAnnotations(name as keyof typeof MCP_TOOL_SCOPES),
    };
    const inputSchema = z
      .object({
        ...boundedMcpInputShape(config.inputSchema ?? {}),
        ...(read
          ? {
              content_cursor: z
                .string()
                .max(2048)
                .optional()
                .describe(
                  'Signed continuation of the same READ result. Keep the original arguments unchanged.',
                ),
            }
          : {}),
      })
      .strict();
    const normalOutput = mcpNormalOutputSchema(name, config.outputSchema);
    const outputSchema = normalOutput
      ? z.union([normalOutput, read ? MCP_READ_PAGE_SCHEMA : MCP_WRITE_SUMMARY_SCHEMA])
      : undefined;
    return original(
      name,
      {
        ...config,
        inputSchema,
        outputSchema,
        annotations,
        _meta: {
          ...config._meta,
          'voxen.dev/requiredScope': scope,
          'voxen.dev/inputLimits': MCP_INPUT_LIMITS,
        },
      },
      async (args, context) => {
        const started = performance.now();
        let code = 'MCP_TOOL_OK';
        const release = limiter.acquire(identity.userId);
        try {
          if (!release) {
            code = 'MCP_BUSY';
            return fail(
              JSON.stringify({
                code,
                requestId: identity.requestId,
                retryAfterSeconds: 1,
                message: 'MCP execution capacity is busy. Retry after the indicated delay.',
              }),
            );
          }
          const { content_cursor, ...originalArgs } = args;
          if (!validMcpArgumentBudget(originalArgs)) {
            code = 'MCP_ARGUMENTS_TOO_LARGE';
            return fail(
              JSON.stringify({
                code,
                requestId: identity.requestId,
                message: 'Tool arguments exceed their identifier, query, nesting or array limits.',
              }),
            );
          }
          const result = await callback(originalArgs, context);
          if ('isError' in result && result.isError) {
            code = 'MCP_TOOL_REJECTED';
            return Buffer.byteLength(JSON.stringify(result)) <= MCP_RESULT_WIRE_BYTES - 4096
              ? result
              : fail(
                  JSON.stringify({
                    code,
                    requestId: identity.requestId,
                    message:
                      'The operation was rejected. Inspect the item in Voxen before retrying.',
                  }),
                );
          }
          if ('structuredContent' in result && result.structuredContent) {
            // Dates and database numeric wrappers must match their public JSON representation.
            const normalized = JSON.parse(JSON.stringify(result.structuredContent)) as Record<
              string,
              unknown
            >;
            if (normalOutput && !normalOutput.safeParse(normalized).success) {
              code = 'MCP_OUTPUT_INVALID';
              return fail(
                JSON.stringify({
                  code,
                  requestId: identity.requestId,
                  message:
                    'Tool returned an invalid public result. For writes, verify current state before retrying.',
                }),
              );
            }
            return ok(
              budgetMcpResult(
                normalized,
                {
                  userId: identity.userId,
                  tool: name,
                  args: originalArgs,
                  requestId: identity.requestId,
                  cursor: typeof content_cursor === 'string' ? content_cursor : undefined,
                },
                scope,
              ),
            );
          }
          return result;
        } catch (error) {
          if (error instanceof McpResultBudgetError) {
            code = error.code;
            return fail(
              JSON.stringify({
                code,
                requestId: identity.requestId,
                message:
                  code === 'MCP_RESULT_TOO_LARGE'
                    ? 'Request a smaller page or a progressive content excerpt.'
                    : 'Restart the READ tool without content_cursor and preserve its original arguments.',
              }),
            );
          }
          code = 'MCP_TOOL_FAILED';
          return fail(
            JSON.stringify({
              code,
              requestId: identity.requestId,
              message: 'Tool execution failed. For writes, verify current state before retrying.',
            }),
          );
        } finally {
          release?.();
          structuredLog(code === 'MCP_TOOL_OK' ? 'info' : 'warning', 'mcp-tool-finished', {
            request_id: identity.requestId,
            actor_id: identity.userId,
            tool_name: name,
            required_scope: scope,
            error_code: code,
            duration_ms: Math.round(performance.now() - started),
          });
        }
      },
    );
  };
  // The SDK supports both raw Zod shapes and standard schemas. Domain callbacks
  // keep their inferred argument types; this adapter normalizes the runtime form.
  server.registerTool = register as typeof server.registerTool;
}
