import { describe, expect, test } from 'bun:test';
import { ApprovalBody } from '../src/lib/chat/approval-input';

describe('chat approval input', () => {
  test('aceita identificador opaco emitido pelo provider', () => {
    expect(ApprovalBody.safeParse({ approvalId: 'approval:tool-call_01JABCDEF' }).success).toBe(
      true,
    );
  });

  test('normaliza espaços externos', () => {
    const result = ApprovalBody.safeParse({ approvalId: '  opaque-approval-id  ' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.approvalId).toBe('opaque-approval-id');
  });

  test('recusa identificador vazio ou acima do limite', () => {
    expect(ApprovalBody.safeParse({ approvalId: '   ' }).success).toBe(false);
    expect(ApprovalBody.safeParse({ approvalId: 'a'.repeat(201) }).success).toBe(false);
  });
});
