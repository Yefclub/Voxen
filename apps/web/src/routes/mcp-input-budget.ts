import { z } from 'zod';
export const MCP_INPUT_LIMITS = {
  queryChars: 2000,
  identifierChars: 256,
  arrayItems: 100,
  maxDepth: 10,
} as const;
function limitFor(name: string): number | null {
  if (/_ids?$/.test(name) || name === 'ref') return MCP_INPUT_LIMITS.identifierChars;
  if (name === 'query') return MCP_INPUT_LIMITS.queryChars;
  if (name === 'heading' || name === 'expected_title') return 1000;
  if (name === 'entity_ref') return 300;
  return null;
}
function boundedField(name: string, schema: z.core.$ZodType): z.core.$ZodType {
  if (!(schema instanceof z.ZodType)) return schema;
  const description = schema.description;
  let bounded: z.ZodType = schema;
  if (schema instanceof z.ZodOptional) {
    const child = boundedField(name, schema.unwrap());
    if (child instanceof z.ZodType) bounded = child.optional();
  } else if (schema instanceof z.ZodNullable) {
    const child = boundedField(name, schema.unwrap());
    if (child instanceof z.ZodType) bounded = child.nullable();
  } else if (schema instanceof z.ZodString) {
    const limit = limitFor(name);
    if (limit !== null) bounded = schema.max(Math.min(schema.maxLength ?? Infinity, limit));
  }
  return description ? bounded.describe(description) : bounded;
}
export function boundedMcpInputShape(shape: z.ZodRawShape): z.ZodRawShape {
  return Object.fromEntries(
    Object.entries(shape).map(([name, schema]) => [name, boundedField(name, schema)]),
  );
}
export function validMcpArgumentBudget(value: unknown, name = '', depth = 0): boolean {
  if (depth > MCP_INPUT_LIMITS.maxDepth) return false;
  if (typeof value === 'string') {
    const limit = limitFor(name);
    return limit === null || value.length <= limit;
  }
  if (Array.isArray(value))
    return (
      value.length <= MCP_INPUT_LIMITS.arrayItems &&
      value.every((item) => validMcpArgumentBudget(item, name, depth + 1))
    );
  if (value && typeof value === 'object')
    return Object.entries(value).every(([key, item]) =>
      validMcpArgumentBudget(item, key, depth + 1),
    );
  return true;
}
