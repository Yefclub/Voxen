export const MAX_MERMAID_FLOW_CHARS = 12_000;
export const MAX_MERMAID_FLOW_NODES = 80;
const MAX_MERMAID_FLOW_LINES = 200;
const MAX_MERMAID_LINE_CHARS = 600;

const HEADER_RE = /^(?:flowchart|graph)\s+(?:TD|TB|BT|LR|RL)$/i;
const FORBIDDEN_RE =
  /%%\s*\{|\b(?:click|callback|call|href)\b|(?:https?:\/\/|data:|javascript:|www\.)|<\/?[a-z!][^>]*>|@\{[^}\n]*(?:img|icon)\s*:/i;
const STYLE_DIRECTIVE_RE = /(?:^|[;\n])\s*(?:style|classDef|linkStyle|class)\b/im;
const NODE_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}/;
const EDGE_TOKENS = ['-.->', '-->', '==>', '~~~'] as const;
const CLOSING_DELIMITER = { '[': ']', '(': ')', '{': '}' } as const;

export type MermaidFlowValidation =
  | { ok: true; code: string; nodeCount: number }
  | { ok: false; error: string };

export function hasUnsafeMermaidCssUrl(value: string): boolean {
  const withoutLocalFragments = value.replace(/url\s*\(\s*(["']?)#[A-Za-z0-9_.:-]+\1\s*\)/gi, '');
  return /url\s*\(/i.test(withoutLocalFragments);
}

function extractCandidate(raw: string): string {
  const trimmed = raw.replace(/^\uFEFF/, '').trim();
  const fenced = /```(?:mermaid)?\s*\n([\s\S]*?)```/i.exec(trimmed);
  return (fenced?.[1] ?? trimmed).trim();
}

function splitSafeStatements(lines: string[]): string[] | null {
  const statements: string[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const stack: string[] = [];
    let quote = '';
    let escaped = false;
    let start = 0;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index] ?? '';
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === '\\') {
        escaped = true;
        continue;
      }
      if (quote) {
        if (character === quote) quote = '';
        continue;
      }
      if (character === '"') {
        quote = character;
        continue;
      }
      if (character in CLOSING_DELIMITER) {
        stack.push(CLOSING_DELIMITER[character as keyof typeof CLOSING_DELIMITER]);
        continue;
      }
      if (character === ']' || character === ')' || character === '}') {
        if (stack.pop() !== character) return null;
        continue;
      }
      if (character === ';' && stack.length === 0) {
        const statement = line.slice(start, index).trim();
        if (statement) statements.push(statement);
        start = index + 1;
      }
    }
    if (stack.length > 0 || quote || escaped) return null;
    const statement = line.slice(start).trim();
    if (statement) statements.push(statement);
  }
  return statements;
}

function consumeNode(statement: string, start: number): { id: string; end: number } | null {
  const idMatch = NODE_ID_RE.exec(statement.slice(start));
  if (!idMatch) return null;
  const id = idMatch[0];
  let index = start + id.length;
  while (/\s/.test(statement[index] ?? '')) index += 1;
  const opener = statement[index] as keyof typeof CLOSING_DELIMITER | undefined;
  if (!opener || !(opener in CLOSING_DELIMITER)) return { id, end: index };

  const stack = [CLOSING_DELIMITER[opener]];
  let quote = '';
  let escaped = false;
  index += 1;
  for (; index < statement.length; index += 1) {
    const character = statement[index] ?? '';
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"') {
      quote = character;
      continue;
    }
    if (character in CLOSING_DELIMITER) {
      stack.push(CLOSING_DELIMITER[character as keyof typeof CLOSING_DELIMITER]);
      continue;
    }
    if (character === ']' || character === ')' || character === '}') {
      if (stack.pop() !== character) return null;
      if (stack.length === 0) return { id, end: index + 1 };
    }
  }
  return null;
}

function parseSafeFlowNodes(code: string): Set<string> | null {
  const lines = code.split(/\r?\n/);
  if (!HEADER_RE.test(lines[0]?.trim() ?? '')) return null;
  const statements = splitSafeStatements(lines.slice(1));
  if (!statements) return null;
  const nodes = new Set<string>();
  for (const statement of statements) {
    let index = 0;
    const firstNode = consumeNode(statement, index);
    if (!firstNode) return null;
    nodes.add(firstNode.id);
    index = firstNode.end;
    while (index < statement.length) {
      while (/\s/.test(statement[index] ?? '')) index += 1;
      if (index >= statement.length) break;
      const edge = EDGE_TOKENS.find((token) => statement.startsWith(token, index));
      if (!edge) return null;
      index += edge.length;
      while (/\s/.test(statement[index] ?? '')) index += 1;
      if (statement[index] === '|') {
        const labelEnd = statement.indexOf('|', index + 1);
        if (labelEnd < 0 || labelEnd - index > 201) return null;
        index = labelEnd + 1;
        while (/\s/.test(statement[index] ?? '')) index += 1;
      }
      const targetNode = consumeNode(statement, index);
      if (!targetNode) return null;
      nodes.add(targetNode.id);
      index = targetNode.end;
    }
  }
  return nodes;
}

export function validateMermaidFlow(raw: string): MermaidFlowValidation {
  const code = extractCandidate(raw);
  if (!code) return { ok: false, error: 'MERMAID_FLOW_EMPTY' };
  if (code.length > MAX_MERMAID_FLOW_CHARS) {
    return { ok: false, error: 'MERMAID_FLOW_TOO_LARGE' };
  }
  const lines = code.split(/\r?\n/);
  if (
    lines.length > MAX_MERMAID_FLOW_LINES ||
    lines.some((line) => line.length > MAX_MERMAID_LINE_CHARS)
  ) {
    return { ok: false, error: 'MERMAID_FLOW_TOO_LARGE' };
  }
  if (!HEADER_RE.test(lines[0]?.trim() ?? '')) {
    return { ok: false, error: 'MERMAID_FLOW_TYPE_UNSUPPORTED' };
  }
  if (FORBIDDEN_RE.test(code) || STYLE_DIRECTIVE_RE.test(code)) {
    return { ok: false, error: 'MERMAID_FLOW_UNSAFE' };
  }
  const nodes = parseSafeFlowNodes(code);
  if (!nodes) return { ok: false, error: 'MERMAID_FLOW_SYNTAX_INVALID' };
  const nodeCount = nodes.size;
  if (nodeCount === 0) return { ok: false, error: 'MERMAID_FLOW_NODES_MISSING' };
  if (nodeCount > MAX_MERMAID_FLOW_NODES) {
    return { ok: false, error: 'MERMAID_FLOW_TOO_MANY_NODES' };
  }
  return { ok: true, code, nodeCount };
}
