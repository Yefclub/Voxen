/**
 * Lógica pura de cap/overflow para os chips de pasta da Biblioteca.
 *
 * Com a criação automática de pastas a partir de tags geradas por IA
 * (PR #352), o número de pastas cresce rápido e a fileira de chips
 * (`transcricoes.tsx`) quebrava em várias linhas. Este módulo isola,
 * sem nenhuma dependência de React/DOM, a decisão de quais pastas
 * aparecem como chip direto na fileira e quais ficam atrás do chip
 * "+K mais" (popover pesquisável).
 */

/** Limite padrão de chips de pasta visíveis antes de agrupar no overflow. */
export const LIBRARY_FOLDER_CHIP_LIMIT = 6;

export interface FolderChipsSplit<T> {
  /** Pastas renderizadas como chip direto na fileira, na ordem recebida. */
  visible: T[];
  /** Pastas restantes, acessíveis via o popover "+K mais", na ordem recebida. */
  overflow: T[];
}

/**
 * Divide uma lista (já ordenada pelo chamador) em `visible` (até `maxVisible`
 * itens) e `overflow` (o restante). Não reordena a lista de entrada.
 *
 * `maxVisible` negativo é tratado como 0 (tudo vai para overflow).
 */
export function splitFolderChips<T>(
  folders: readonly T[],
  maxVisible: number,
): FolderChipsSplit<T> {
  const max = Math.max(0, Math.floor(maxVisible));
  if (folders.length <= max) {
    return { visible: [...folders], overflow: [] };
  }
  return { visible: folders.slice(0, max), overflow: folders.slice(max) };
}

/**
 * Filtra pastas por substring do nome, sem diferenciar maiúsculas/minúsculas.
 * Query vazia (ou só espaços) retorna a lista completa, sem filtrar.
 */
export function filterFoldersByQuery<T extends { name: string }>(
  folders: readonly T[],
  query: string,
): T[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...folders];
  return folders.filter((folder) => folder.name.toLowerCase().includes(normalized));
}
