export const ptBrLibraryNavigationMessages = {
  'library.filtersTitle': 'Filtros da biblioteca',
  'library.activeFilters': '{count} ativos',
  'library.clearFilters': 'Limpar filtros',
  'library.filterFolders': 'Buscar pastas',
  'library.resultsRange': '{from}–{to} de {total}',
  'library.pagination': 'Página {page} de {pages}',
  'library.previousPage': 'Anterior',
  'library.nextPage': 'Próxima',
  'library.goToPage': 'Ir para a página {page}',
} as const;

export const enLibraryNavigationMessages: Record<
  keyof typeof ptBrLibraryNavigationMessages,
  string
> = {
  'library.filtersTitle': 'Library filters',
  'library.activeFilters': '{count} active',
  'library.clearFilters': 'Clear filters',
  'library.filterFolders': 'Search folders',
  'library.resultsRange': '{from}–{to} of {total}',
  'library.pagination': 'Page {page} of {pages}',
  'library.previousPage': 'Previous',
  'library.nextPage': 'Next',
  'library.goToPage': 'Go to page {page}',
};
