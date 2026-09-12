export const ptBrReleaseUpdateMessages = {
  'shell.versionOpenChangelog': 'Clique para ver as novidades',
  'shell.nav.changelog': 'Novidades',
  'shell.releaseAvailable': '{version} disponível',
  'shell.releaseDetails': '{environment} · atual {current}',
  'shell.releaseEnvironment.dev': 'DEV',
  'shell.releaseEnvironment.prod': 'PRODUÇÃO',
} as const;

export const enReleaseUpdateMessages: Record<keyof typeof ptBrReleaseUpdateMessages, string> = {
  'shell.versionOpenChangelog': 'Click to view release notes',
  'shell.nav.changelog': 'News',
  'shell.releaseAvailable': '{version} available',
  'shell.releaseDetails': '{environment} · current {current}',
  'shell.releaseEnvironment.dev': 'DEV',
  'shell.releaseEnvironment.prod': 'PRODUCTION',
};
