import type { Locale } from '../../lib/i18n';

const PT = {
  title: 'Correções da transcrição',
  revision: 'Revisão',
  stale: 'Obsoleta',
  description:
    'Corrija trechos sem alterar a evidência original. Cada mudança cria uma revisão auditável.',
  staleDescription:
    'A fonte mudou; as correções antigas foram preservadas e a leitura voltou ao conteúdo original.',
  edit: 'Corrigir',
  close: 'Fechar',
  history: 'Histórico',
  showOriginal: 'Ver original',
  hideOriginal: 'Ocultar original',
  originalEvidence: 'Evidência original imutável',
  replace: 'Substituir trecho',
  insertBefore: 'Inserir antes',
  insertAfter: 'Inserir depois',
  prepend: 'Adicionar no início',
  append: 'Adicionar no fim',
  occurrence: 'Ocorrência (opcional)',
  target: 'Trecho exato a localizar',
  text: 'Novo texto',
  preview: 'Pré-visualizar',
  apply: 'Aplicar correção',
  previewAt: 'Linha {line} · {count} ocorrência(s)',
  restore: 'Restaurar',
  inspect: 'Inspecionar',
  loadOlder: 'Carregar revisões anteriores',
  reset: 'Voltar ao conteúdo original',
  emptyHistory: 'Nenhuma correção registrada.',
  noSummary: 'Sem descrição',
  applied: 'Correção aplicada e reindexação agendada.',
  restored: 'Revisão restaurada em uma nova versão.',
  loadError: 'Não foi possível carregar a camada de correções.',
  previewError: 'Não foi possível gerar a prévia.',
  applyError: 'Não foi possível aplicar a correção.',
  historyError: 'Não foi possível carregar o histórico.',
  restoreError: 'Não foi possível restaurar a revisão.',
  resetError: 'Não foi possível voltar ao conteúdo original.',
  actorUser: 'Usuário',
  actorMcp: 'MCP',
  actorChat: 'Chat',
  actorRestore: 'Restauração',
  actorSystem: 'Sistema',
  summaryReplace: 'Substituição de trecho exato',
  summaryInsertBefore: 'Inserção antes de trecho exato',
  summaryInsertAfter: 'Inserção depois de trecho exato',
  summaryPrepend: 'Inserção no início',
  summaryAppend: 'Inserção no fim',
  summaryRestore: 'Restauração da revisão {revision}',
  summaryReset: 'Retorno ao conteúdo original',
} as const;

type CorrectionCopy = { [Key in keyof typeof PT]: string };

const EN: CorrectionCopy = {
  title: 'Transcript corrections',
  revision: 'Revision',
  stale: 'Stale',
  description:
    'Correct passages without changing the original evidence. Every change creates an auditable revision.',
  staleDescription:
    'The source changed; old corrections were preserved and reads reverted to the original content.',
  edit: 'Correct',
  close: 'Close',
  history: 'History',
  showOriginal: 'View original',
  hideOriginal: 'Hide original',
  originalEvidence: 'Immutable original evidence',
  replace: 'Replace passage',
  insertBefore: 'Insert before',
  insertAfter: 'Insert after',
  prepend: 'Add at start',
  append: 'Add at end',
  occurrence: 'Occurrence (optional)',
  target: 'Exact passage to find',
  text: 'New text',
  preview: 'Preview',
  apply: 'Apply correction',
  previewAt: 'Line {line} · {count} occurrence(s)',
  restore: 'Restore',
  inspect: 'Inspect',
  loadOlder: 'Load older revisions',
  reset: 'Return to original content',
  emptyHistory: 'No corrections recorded.',
  noSummary: 'No description',
  applied: 'Correction applied and reindexing queued.',
  restored: 'Revision restored as a new version.',
  loadError: 'Could not load the correction layer.',
  previewError: 'Could not generate the preview.',
  applyError: 'Could not apply the correction.',
  historyError: 'Could not load correction history.',
  restoreError: 'Could not restore the revision.',
  resetError: 'Could not return to the original content.',
  actorUser: 'User',
  actorMcp: 'MCP',
  actorChat: 'Chat',
  actorRestore: 'Restore',
  actorSystem: 'System',
  summaryReplace: 'Exact passage replacement',
  summaryInsertBefore: 'Insertion before exact passage',
  summaryInsertAfter: 'Insertion after exact passage',
  summaryPrepend: 'Insertion at start',
  summaryAppend: 'Insertion at end',
  summaryRestore: 'Restore revision {revision}',
  summaryReset: 'Return to original content',
};

export function transcriptCorrectionCopy(locale: Locale): CorrectionCopy {
  return locale === 'en' ? EN : PT;
}

export function actorLabel(actor: string, copy: CorrectionCopy): string {
  return (
    {
      USER: copy.actorUser,
      MCP: copy.actorMcp,
      CHAT: copy.actorChat,
      RESTORE: copy.actorRestore,
      SYSTEM: copy.actorSystem,
    }[actor] ?? actor
  );
}

export function summaryLabel(summary: string | null, copy: CorrectionCopy): string {
  if (!summary) return copy.noSummary;
  const exact = {
    'Replace exact passage': copy.summaryReplace,
    'Insert before exact passage': copy.summaryInsertBefore,
    'Insert after exact passage': copy.summaryInsertAfter,
    'Prepend content': copy.summaryPrepend,
    'Append content': copy.summaryAppend,
    'Reset corrections to canonical source': copy.summaryReset,
  }[summary];
  if (exact) return exact;
  const restored = /^Restore correction revision (\d+)(?: through MCP)?$/.exec(summary);
  return restored ? copy.summaryRestore.replace('{revision}', restored[1]!) : summary;
}
