/**
 * Políticas puras de HITL: gating always-allow e texto de resume do agente.
 * Sem DOM, sem Prisma — testável com bun test.
 */

export const HITL_ACTION_CREATE_NOTE = 'create_note' as const;
export const HITL_ACTION_PATCH_NOTE = 'patch_note' as const;
export const HITL_ACTION_PATCH_TRANSCRIPT = 'patch_transcript' as const;
export const HITL_ACTION_DELETE_KNOWLEDGE = 'delete_knowledge' as const;

export type HitlWriteAction =
  | typeof HITL_ACTION_CREATE_NOTE
  | typeof HITL_ACTION_PATCH_NOTE
  | typeof HITL_ACTION_PATCH_TRANSCRIPT
  | typeof HITL_ACTION_DELETE_KNOWLEDGE;
type HitlAlwaysAllowAction = typeof HITL_ACTION_CREATE_NOTE;

/** Setting USER-scoped: JSON array de ações liberadas. */
export const HITL_ALWAYS_ALLOW_SETTING_KEY = 'hitl_always_allow';

export function isHitlWriteAction(value: string): value is HitlWriteAction {
  return (
    value === HITL_ACTION_CREATE_NOTE ||
    value === HITL_ACTION_PATCH_NOTE ||
    value === HITL_ACTION_PATCH_TRANSCRIPT ||
    value === HITL_ACTION_DELETE_KNOWLEDGE
  );
}

/** Parse JSON de preferências; entradas desconhecidas são ignoradas. */
export function parseAlwaysAllowActions(
  raw: string | null | undefined,
): Set<HitlAlwaysAllowAction> {
  if (!raw?.trim()) return new Set();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    const out = new Set<HitlAlwaysAllowAction>();
    for (const item of parsed) {
      if (item === HITL_ACTION_CREATE_NOTE) out.add(item);
    }
    return out;
  } catch {
    return new Set();
  }
}

export function serializeAlwaysAllowActions(actions: ReadonlySet<string>): string {
  const list = [...actions].filter((action) => action === HITL_ACTION_CREATE_NOTE).sort();
  return JSON.stringify(list);
}

export function withAlwaysAllowAction(
  current: ReadonlySet<string>,
  action: string,
): Set<HitlAlwaysAllowAction> {
  const next = parseAlwaysAllowActions(serializeAlwaysAllowActions(current));
  if (action === HITL_ACTION_CREATE_NOTE) next.add(action);
  return next;
}

/**
 * True quando o turno deve pausar e pedir confirmação humana.
 * Always-allow para a ação desliga o pause.
 */
export function shouldRequireHitlApproval(args: {
  action: string;
  alwaysAllowed: ReadonlySet<string>;
}): boolean {
  if (!isHitlWriteAction(args.action)) return false;
  if (
    args.action === HITL_ACTION_PATCH_NOTE ||
    args.action === HITL_ACTION_PATCH_TRANSCRIPT ||
    args.action === HITL_ACTION_DELETE_KNOWLEDGE
  )
    return true;
  return !args.alwaysAllowed.has(args.action);
}

/**
 * Valor de `toolApproval` do AI SDK para propose_create_note.
 * - user-approval: pausa estrutural (spec 090)
 * - approved: executa a tool sem UI (always-allow)
 */
export function resolveProposeCreateNoteApproval(
  alwaysAllowCreateNote: boolean,
): 'user-approval' | 'approved' {
  return alwaysAllowCreateNote ? 'approved' : 'user-approval';
}

export function buildHitlResumePrompt(args: {
  action: string;
  title?: string | null;
  noteId?: string | null;
}): string {
  if (args.action === HITL_ACTION_CREATE_NOTE) {
    const title = args.title?.trim() || 'sem título';
    return [
      'O usuário confirmou a criação da nota na interface.',
      `A nota “${title}” foi criada com sucesso.`,
      'Continue o plano anterior: confirme de forma natural o que foi feito e prossiga com o que ainda faltava.',
      'Não proponha criar a mesma nota de novo. Não mencione IDs internos nem nomes de ferramentas.',
    ].join(' ');
  }
  if (args.action === HITL_ACTION_PATCH_NOTE) {
    const title = args.title?.trim() || 'sem título';
    return [
      'O usuário confirmou a edição cirúrgica da nota na interface.',
      `A nova revisão de “${title}” foi criada com sucesso.`,
      'Continue o plano anterior: confirme de forma natural o trecho atualizado e prossiga com o que ainda faltava.',
      'Não proponha a mesma edição de novo. Não mencione IDs internos nem nomes de ferramentas.',
    ].join(' ');
  }
  if (args.action === HITL_ACTION_PATCH_TRANSCRIPT) {
    const title = args.title?.trim() || 'sem título';
    return [
      'O usuário confirmou a correção cirúrgica da transcrição na interface.',
      `A nova revisão de “${title}” foi criada com sucesso sem alterar a fonte original.`,
      'Continue o plano anterior: confirme de forma natural o trecho corrigido e prossiga com o que ainda faltava.',
      'Não proponha a mesma correção de novo. Não mencione IDs internos nem nomes de ferramentas.',
    ].join(' ');
  }
  if (args.action === HITL_ACTION_DELETE_KNOWLEDGE) {
    const title = args.title?.trim() || 'sem título';
    return [
      'O usuário confirmou a exclusão permanente na interface.',
      `A exclusão de “${title}” foi adicionada à fila de processamento.`,
      'Continue o plano anterior sem afirmar que a limpeza já terminou.',
      'Não proponha a mesma exclusão de novo. Não mencione IDs internos nem nomes de ferramentas.',
    ].join(' ');
  }
  return [
    'O usuário confirmou a ação pendente na interface.',
    'Continue o plano anterior com base no que já foi concluído.',
    'Não mencione IDs internos nem nomes de ferramentas.',
  ].join(' ');
}

/** Decide se o approve deve disparar um turno de resume do agente. */
export function shouldResumeAfterApprove(args: { approved: boolean; action: string }): boolean {
  return args.approved && isHitlWriteAction(args.action);
}

/**
 * Decide se o `content` do turno deve ser injetado como mensagem user extra no
 * call do modelo (resume HITL: prompt sintético ausente da trilha USER).
 */
export function shouldInjectTurnContentAsUserMessage(args: {
  content: string;
  history: ReadonlyArray<{ role: string; content: string }>;
}): boolean {
  if (!args.content.trim()) return false;
  return !args.history.some(
    (message) => message.role === 'USER' && message.content === args.content,
  );
}
