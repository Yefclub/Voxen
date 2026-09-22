export const ptBrReleaseUpdateMessages = {
  'shell.versionOpenChangelog': 'Clique para ver as novidades',
  'shell.nav.changelog': 'Novidades',
  'shell.releaseAvailableIn': '{environment} {version} disponível',
  'shell.releaseDetails': 'atual {environment} {current}',
  'shell.releaseEnvironment.dev': 'DEV',
  'shell.releaseEnvironment.prod': 'PRODUÇÃO',
} as const;

export const enReleaseUpdateMessages: Record<keyof typeof ptBrReleaseUpdateMessages, string> = {
  'shell.versionOpenChangelog': 'Click to view release notes',
  'shell.nav.changelog': 'News',
  'shell.releaseAvailableIn': '{environment} {version} available',
  'shell.releaseDetails': 'current {environment} {current}',
  'shell.releaseEnvironment.dev': 'DEV',
  'shell.releaseEnvironment.prod': 'PRODUCTION',
};
