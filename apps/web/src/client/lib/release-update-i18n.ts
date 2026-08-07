export const ptBrReleaseUpdateMessages = {
  'shell.releaseAvailable': '{version} disponível',
  'shell.releaseDetails': '{environment} · atual {current}',
  'shell.releaseEnvironment.dev': 'DEV',
  'shell.releaseEnvironment.prod': 'PRODUÇÃO',
} as const;

export const enReleaseUpdateMessages: Record<keyof typeof ptBrReleaseUpdateMessages, string> = {
  'shell.releaseAvailable': '{version} available',
  'shell.releaseDetails': '{environment} · current {current}',
  'shell.releaseEnvironment.dev': 'DEV',
  'shell.releaseEnvironment.prod': 'PRODUCTION',
};
