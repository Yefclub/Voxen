export interface GraphIndexState {
  force: boolean;
  expectedSourceNodes: number;
  indexedSourceNodes: number;
  staleSourceNodes: number;
}

/** Decide se o Brain precisa de um novo passe sem executar trabalho no GET. */
export function shouldScheduleGraphReindex(state: GraphIndexState): boolean {
  if (state.expectedSourceNodes === 0) return false;
  return (
    state.force ||
    state.indexedSourceNodes < state.expectedSourceNodes ||
    state.staleSourceNodes > 0
  );
}
