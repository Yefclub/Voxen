import type { McpServer, ToolCallback, ToolAnnotations } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { structuredLog } from '../lib/structured-log';
import { MCP_TOOL_SCOPES } from './mcp-tool-policy';
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
export function installMcpToolExecution(server: McpServer, identity: ExecutionIdentity): void {
  const original = server.registerTool.bind(server);
  const register = (name: string, config: ToolConfig, callback: ToolCallback<Input>) => {
    if (!Object.hasOwn(MCP_TOOL_SCOPES, name)) throw new Error('MCP tool policy is missing');
    const scope = MCP_TOOL_SCOPES[name as keyof typeof MCP_TOOL_SCOPES];
    const read = scope === 'READ';
    const annotations: ToolAnnotations = {
      ...config.annotations,
      readOnlyHint: read,
      destructiveHint: read ? false : (config.annotations?.destructiveHint ?? false),
      idempotentHint: read ? true : (config.annotations?.idempotentHint ?? false),
      openWorldHint: read ? false : (config.annotations?.openWorldHint ?? false),
    };
    return original(
      name,
      {
        ...config,
        inputSchema: z.object(config.inputSchema ?? {}),
        outputSchema: config.outputSchema ? z.object(config.outputSchema) : undefined,
        annotations,
        _meta: { ...config._meta, 'voxen.dev/requiredScope': scope },
      },
      async (args, context) => {
        const started = performance.now();
        let code = 'MCP_TOOL_OK';
        try {
          const result = await callback(args, context);
          if ('isError' in result && result.isError) {
            code = 'MCP_TOOL_REJECTED';
            return result;
          }
          if ('structuredContent' in result && result.structuredContent) {
            // Dates and database numeric wrappers must match their public JSON representation.
            const normalized = JSON.parse(JSON.stringify(result.structuredContent)) as Record<
              string,
              unknown
            >;
            return ok(normalized);
          }
          return result;
        } catch {
          code = 'MCP_TOOL_FAILED';
          return fail(
            JSON.stringify({
              code,
              requestId: identity.requestId,
              message: 'Tool execution failed. For writes, verify current state before retrying.',
            }),
          );
        } finally {
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
