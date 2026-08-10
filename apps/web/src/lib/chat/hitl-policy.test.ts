import { describe, expect, test } from 'bun:test';
import {
  HITL_ACTION_CREATE_NOTE,
  HITL_ACTION_PATCH_NOTE,
  HITL_ACTION_PATCH_TRANSCRIPT,
  buildHitlResumePrompt,
  parseAlwaysAllowActions,
  resolveProposeCreateNoteApproval,
  serializeAlwaysAllowActions,
  shouldInjectTurnContentAsUserMessage,
  shouldRequireHitlApproval,
  shouldResumeAfterApprove,
  withAlwaysAllowAction,
} from './hitl-policy';

describe('always-allow preferences', () => {
  test('parse ignora JSON inválido e ações desconhecidas', () => {
    expect([...parseAlwaysAllowActions(null)]).toEqual([]);
    expect([...parseAlwaysAllowActions('not-json')]).toEqual([]);
    expect([...parseAlwaysAllowActions('["create_note","delete_world"]')]).toEqual([
      HITL_ACTION_CREATE_NOTE,
    ]);
  });

  test('withAlwaysAllowAction adiciona create_note de forma estável', () => {
    const next = withAlwaysAllowAction(new Set(), HITL_ACTION_CREATE_NOTE);
    expect(next.has(HITL_ACTION_CREATE_NOTE)).toBe(true);
    expect(serializeAlwaysAllowActions(next)).toBe('["create_note"]');
    expect(withAlwaysAllowAction(next, HITL_ACTION_PATCH_NOTE)).toEqual(next);
  });
});

describe('gating HITL', () => {
  test('exige aprovação só quando a ação não está em always-allow', () => {
    expect(
      shouldRequireHitlApproval({
        action: HITL_ACTION_CREATE_NOTE,
        alwaysAllowed: new Set(),
      }),
    ).toBe(true);
    expect(
      shouldRequireHitlApproval({
        action: HITL_ACTION_CREATE_NOTE,
        alwaysAllowed: new Set([HITL_ACTION_CREATE_NOTE]),
      }),
    ).toBe(false);
    expect(
      shouldRequireHitlApproval({
        action: 'other',
        alwaysAllowed: new Set(),
      }),
    ).toBe(false);
  });

  test('toolApproval: user-approval vs approved', () => {
    expect(resolveProposeCreateNoteApproval(false)).toBe('user-approval');
    expect(resolveProposeCreateNoteApproval(true)).toBe('approved');
  });

  test('edição de nota sempre exige confirmação e nunca herda always-allow', () => {
    expect(
      shouldRequireHitlApproval({
        action: HITL_ACTION_PATCH_NOTE,
        alwaysAllowed: new Set([HITL_ACTION_CREATE_NOTE]),
      }),
    ).toBe(true);
    expect(
      shouldRequireHitlApproval({
        action: HITL_ACTION_PATCH_TRANSCRIPT,
        alwaysAllowed: new Set([HITL_ACTION_CREATE_NOTE]),
      }),
    ).toBe(true);
  });
});

describe('resume após approve', () => {
  test('só retoma para ações de escrita HITL bem-sucedidas', () => {
    expect(shouldResumeAfterApprove({ approved: true, action: HITL_ACTION_CREATE_NOTE })).toBe(
      true,
    );
    expect(shouldResumeAfterApprove({ approved: false, action: HITL_ACTION_CREATE_NOTE })).toBe(
      false,
    );
    expect(shouldResumeAfterApprove({ approved: true, action: 'other' })).toBe(false);
    expect(shouldResumeAfterApprove({ approved: true, action: HITL_ACTION_PATCH_NOTE })).toBe(true);
    expect(shouldResumeAfterApprove({ approved: true, action: HITL_ACTION_PATCH_TRANSCRIPT })).toBe(
      true,
    );
  });

  test('prompt de resume distingue uma correção de transcrição', () => {
    const prompt = buildHitlResumePrompt({
      action: HITL_ACTION_PATCH_TRANSCRIPT,
      title: 'Entrevista',
    });
    expect(prompt).toContain('correção cirúrgica');
    expect(prompt).toContain('fonte original');
    expect(prompt).toContain('Entrevista');
  });

  test('prompt de resume distingue uma edição confirmada', () => {
    const prompt = buildHitlResumePrompt({ action: HITL_ACTION_PATCH_NOTE, title: 'Ideias' });
    expect(prompt).toContain('edição cirúrgica');
    expect(prompt).toContain('Ideias');
  });

  test('prompt de resume cita a nota e pede continuidade sem re-propor', () => {
    const prompt = buildHitlResumePrompt({
      action: HITL_ACTION_CREATE_NOTE,
      title: 'Ideias',
      noteId: 'n1',
    });
    expect(prompt).toContain('Ideias');
    expect(prompt.toLowerCase()).toContain('confirm');
    expect(prompt).toContain('Continue o plano anterior');
    expect(prompt).not.toContain('n1');
  });

  test('injeta content sintético no call do modelo só quando não está na trilha USER', () => {
    const resume = buildHitlResumePrompt({
      action: HITL_ACTION_CREATE_NOTE,
      title: 'X',
    });
    expect(
      shouldInjectTurnContentAsUserMessage({
        content: resume,
        history: [
          { role: 'USER', content: 'cria uma nota' },
          { role: 'ASSISTANT', content: '' },
          { role: 'SYSTEM', content: 'Nota “X” criada após confirmação do usuário.' },
        ],
      }),
    ).toBe(true);
    expect(
      shouldInjectTurnContentAsUserMessage({
        content: 'cria uma nota',
        history: [{ role: 'USER', content: 'cria uma nota' }],
      }),
    ).toBe(false);
  });
});
