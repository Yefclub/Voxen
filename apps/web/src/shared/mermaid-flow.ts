export const MAX_MERMAID_FLOW_CHARS = 12_000;
export const MAX_MERMAID_FLOW_NODES = 80;
const MAX_MERMAID_FLOW_LINES = 200;
const MAX_MERMAID_LINE_CHARS = 600;

const HEADER_RE = /^(?:flowchart|graph)\s+(?:TD|TB|BT|LR|RL)\b/i;
const FORBIDDEN_RE =
  /%%\s*\{|\b(?:click|callback|call|href)\b|(?:https?:\/\/|data:|javascript:|www\.)|<\/?[a-z!][^>]*>|@\{[^}\n]*(?:img|icon)\s*:/i;
const NODE_DECLARATION_RE = /(?:^|[\s;])([A-Za-z][A-Za-z0-9_-]{0,63})\s*(?=\[|\(|\{)/gm;
const EDGE_SOURCE_RE = /(?:^|[\s;])([A-Za-z][A-Za-z0-9_-]{0,63})\s*(?=-+>|=+>|-+\.|~~~)/gm;
const EDGE_TARGET_RE =
  /(?:-+>|=+>|-+\.|~~~)(?:\|[^|\n]{0,200}\|)?\s*([A-Za-z][A-Za-z0-9_-]{0,63})/gm;

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

function countNodes(code: string): number {
  const nodes = new Set<string>();
  for (const pattern of [NODE_DECLARATION_RE, EDGE_SOURCE_RE, EDGE_TARGET_RE]) {
    pattern.lastIndex = 0;
    for (const match of code.matchAll(pattern)) {
      const nodeId = match[1];
      if (nodeId) nodes.add(nodeId);
    }
  }
  return nodes.size;
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
  if (!HEADER_RE.test(code)) return { ok: false, error: 'MERMAID_FLOW_TYPE_UNSUPPORTED' };
  if (FORBIDDEN_RE.test(code)) return { ok: false, error: 'MERMAID_FLOW_UNSAFE' };
  const nodeCount = countNodes(code);
  if (nodeCount === 0) return { ok: false, error: 'MERMAID_FLOW_NODES_MISSING' };
  if (nodeCount > MAX_MERMAID_FLOW_NODES) {
    return { ok: false, error: 'MERMAID_FLOW_TOO_MANY_NODES' };
  }
  return { ok: true, code, nodeCount };
}
