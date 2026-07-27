export interface GraphIndexState {
  force: boolean;
  expectedSourceNodes: number;
  indexedSourceNodes: number;
  staleSourceNodes: number;
}

/** Decide se o Brain precisa de um novo passe sem executar trabalho no GET. */
export function shouldScheduleGraphReindex(state: GraphIndexState): boolean {
  if (state.expectedSourceNodes === 0) {
    return state.indexedSourceNodes > 0 || state.staleSourceNodes > 0;
  }
  return (
    state.force ||
    state.indexedSourceNodes !== state.expectedSourceNodes ||
    state.staleSourceNodes > 0
  );
}

/**
 * Mantém o snapshot conservador quando um reindex terminou durante a leitura.
 * Nesse caso a resposta atual não pode ser cacheada e o cliente deve buscar o
 * estado materializado mais uma vez.
 */
export function isGraphSnapshotIndexing(
  indexingAtReadStart: boolean,
  indexingAtReadEnd: boolean,
): boolean {
  return indexingAtReadStart || indexingAtReadEnd;
}
