import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

export type Locale = 'pt-BR' | 'en';

export const LOCALES: Record<Locale, { nativeName: string; shortName: string }> = {
  'pt-BR': { nativeName: 'Português (Brasil)', shortName: 'PT-BR' },
  en: { nativeName: 'English', shortName: 'EN' },
};

const STORAGE_KEY = 'voxen:locale';

const ptBRMessages = {
  'common.back': 'Voltar',
  'common.close': 'Fechar',
  'common.continue': 'Continuar',
  'common.language': 'Idioma',
  'common.optional': 'opcional',
  'common.saveContinue': 'Salvar e continuar',

  'modelPicker.available': '{count} disponíveis',
  'modelPicker.clear': 'Não configurar',
  'modelPicker.clearHint': 'Recurso fica desabilitado ou usa fallback.',
  'modelPicker.empty': 'Nenhum modelo encontrado.',
  'modelPicker.filter': 'Filtrar por nome, provedor ou ID',
  'modelPicker.notConfigured': 'Não configurado',
  'modelPicker.select': 'Selecione um modelo',
  'modelPicker.total': '{count} modelos disponíveis',

  'auth.email': 'E-mail',
  'auth.password': 'Senha',
  'auth.passwordConfirm': 'Confirmar senha',
  'auth.passwordMin': 'Mínimo 12 caracteres',
  'auth.name': 'Nome',
  'auth.namePlaceholder': 'Como prefere ser chamado',
  'auth.emailPlaceholder': 'voce@exemplo.com',
  'auth.signIn': 'Entrar',
  'auth.signInTitle': 'Bem-vindo de volta',
  'auth.signInSubtitle': 'Acesse sua biblioteca de vídeos transcritos.',
  'auth.signInError': 'E-mail ou senha incorretos.',
  'auth.unexpectedError': 'Erro inesperado. Tente novamente.',
  'auth.noAccount': 'Ainda não tem conta?',
  'auth.createAccount': 'Criar conta',
  'auth.signupsClosed': 'Cadastros novos estão fechados nesta instância',
  'auth.firstRunTitle': 'Primeira vez por aqui',
  'auth.firstRunSubtitle':
    'Nenhum usuário cadastrado ainda. Crie a conta principal — ela será a administradora desta instância.',
  'auth.createAdmin': 'Criar conta administradora',
  'auth.heroTitle.prefix': 'Sua biblioteca de vídeos,',
  'auth.heroTitle.highlight': 'na ponta da pergunta.',
  'auth.heroSubtitle':
    'Cole um link, o Voxen transcreve e indexa. Depois, converse com sua biblioteca como se fosse um colega que já assistiu tudo.',
  'signup.titleFirst': 'Criar conta principal',
  'signup.titleDefault': 'Criar conta no Voxen',
  'signup.subtitleFirst': 'Esta será a conta administradora da instância.',
  'signup.subtitleDefault': 'Você poderá usar a plataforma assim que o administrador aprovar.',
  'signup.passwordTooShort': 'A senha precisa ter pelo menos 12 caracteres.',
  'signup.passwordMismatch': 'As senhas não conferem.',
  'signup.submitFirst': 'Criar e configurar',
  'signup.submitDefault': 'Criar conta',
  'signup.hasAccount': 'Já tem conta?',
  'signup.strength.weak': 'Fraca',
  'signup.strength.fair': 'Razoável',
  'signup.strength.good': 'Boa',
  'signup.strength.strong': 'Forte',

  'onboarding.language.eyebrow': '01 · Idioma',
  'onboarding.language.title': 'Escolha o idioma da plataforma',
  'onboarding.language.sub':
    'A interface muda agora e a escolha fica salva para esta instância ao finalizar o onboarding.',
  'onboarding.language.ptHint': 'Idioma principal do projeto e da documentação.',
  'onboarding.language.enHint': 'English interface foundation for open-source users.',
  'onboarding.connection.eyebrow': '02 · Conexão',
  'onboarding.connection.title': 'Conecte com a OpenRouter',
  'onboarding.connection.sub':
    'Uma chave dá acesso aos modelos de transcrição (Whisper) e ao agente que conversa com sua biblioteca.',
  'onboarding.keyCta': 'Não tem chave? Gerar agora',
  'onboarding.validateContinue': 'Validar e continuar',
  'onboarding.models.eyebrow': '03 · Modelos',
  'onboarding.models.title': 'Escolha os modelos padrão',
  'onboarding.models.sub':
    'Whisper Large Turbo é a melhor relação custo/qualidade para transcrição. Para o chat, prefira modelos com contexto grande.',
  'onboarding.models.transcription': 'Transcrição',
  'onboarding.models.chat': 'Chat',
  'onboarding.models.web': 'Pesquisa web',
  'onboarding.models.webHint':
    'Usado pela tool web_search com sufixo :online. Vazio = usa o modelo de chat.',
  'onboarding.models.vision': 'Visão',
  'onboarding.models.visionHint':
    'Habilita envio de imagens no chat e no Telegram. Vazio = recurso desabilitado.',
  'onboarding.models.documents': 'Documentos',
  'onboarding.models.documentsHint':
    'Modelos OpenRouter com input nativo de arquivo/PDF. Vazio = análise documental desabilitada.',
  'onboarding.models.x': 'X / Grok',
  'onboarding.models.xHint': 'Analisa posts e threads do X com Grok/xAI e busca nativa no X.',
  'onboarding.mode.eyebrow': '04 · Modo de uso',
  'onboarding.mode.title': 'Quem vai usar esta instância?',
  'onboarding.mode.sub':
    'Você pode mudar essa configuração depois nas configurações administrativas.',
  'onboarding.mode.team': 'Equipe',
  'onboarding.mode.teamDesc': 'Permitir que outros usuários se cadastrem (você aprova cada um).',
  'onboarding.mode.solo': 'Apenas você',
  'onboarding.mode.soloDesc': 'Fechar cadastros novos. Ninguém mais consegue criar conta.',
  'onboarding.profile.eyebrow': '05 · Perfil (opcional)',
  'onboarding.profile.title': 'Coloque sua cara nisso',
  'onboarding.profile.sub': 'Adicione uma foto se quiser — ou pule e termine agora.',
  'onboarding.profile.upload': 'Enviar imagem',
  'onboarding.profile.fileHint': 'PNG, JPG ou WebP até 5MB',
  'onboarding.profile.finish': 'Concluir',
  'onboarding.done.title': 'Tudo pronto, {name}.',
  'onboarding.done.sub': 'Levando você ao painel…',
  'onboarding.error.key': 'Erro ao validar chave.',
  'onboarding.error.save': 'Erro ao salvar configuração.',
  'onboarding.error.avatar': 'Erro ao enviar imagem.',
  'onboarding.error.finish': 'Erro ao finalizar.',

  'setup.badge.initial': 'Configuração inicial',
  'setup.badge.edit': 'Configurações',
  'setup.title.initial': 'Conecte com a OpenRouter',
  'setup.title.edit': 'Configurações da instância',
  'setup.subtitle.initial':
    'Uma chave da OpenRouter dá acesso a Whisper para transcrição e a vários modelos de chat. É a única dependência externa do Voxen.',
  'setup.subtitle.edit':
    'Edite chave, modelos padrão, operação e extração de mídia sem sair da página.',
  'setup.step.key': 'Chave',
  'setup.step.models': 'Modelos',
  'setup.validationTitle': 'Não consegui validar',
  'setup.saved': 'Configurações salvas.',
  'setup.doneTitle': 'Salvo.',
  'setup.doneSubtitle': 'Configuração atualizada. Levando você ao painel…',
  'setup.language.title': 'Idioma da plataforma',
  'setup.language.description':
    'Define o idioma padrão da interface para esta instância. A mudança é aplicada na hora e persistida ao salvar.',
  'setup.openrouter.title': 'OpenRouter',
  'setup.openrouter.description.active':
    'A chave salva permanece cifrada. Cole uma nova apenas quando quiser substituir a atual.',
  'setup.openrouter.description.new':
    'A chave validada será salva junto com os modelos escolhidos.',
  'setup.openrouter.active': 'Chave ativa',
  'setup.openrouter.stored': 'Chave armazenada e pronta para uso.',
  'setup.openrouter.newKey': 'Nova OpenRouter API key (opcional)',
  'setup.openrouter.apiKey': 'OpenRouter API key',
  'setup.openrouter.refreshModels': 'Atualizar modelos',
  'setup.openrouter.refreshHint.active':
    'Atualizar modelos valida a chave digitada; se o campo estiver vazio, usa a chave já salva na instância.',
  'setup.openrouter.refreshHint.new':
    'Atualizar modelos revalida a chave digitada antes de carregar o catálogo.',
  'setup.models.title': 'Modelos padrão',
  'setup.models.description':
    'Escolha os modelos que a instância usa para chat, transcrição, visão, documentos, pesquisa web e análise do X.',
  'setup.models.transcription': 'Modelo de transcrição',
  'setup.models.chat': 'Modelo de chat',
  'setup.models.web': 'Modelo de pesquisa web (opcional)',
  'setup.models.webHint':
    'Tool web_search usa este modelo com sufixo :online (plugin Perplexity). Vazio = usa o de chat.',
  'setup.models.vision': 'Modelo de visão (opcional)',
  'setup.models.visionHint':
    'Pra entender imagens enviadas no chat. Vazio = uploads ficam desabilitados.',
  'setup.models.documents': 'Modelo de documentos/PDF (opcional)',
  'setup.models.documentsHint':
    'Filtrado por modelos OpenRouter com entrada nativa de arquivo/PDF. Vazio = upload de documentos fica desabilitado.',
  'setup.models.x': 'Modelo de análise do X (Grok)',
  'setup.models.xHint':
    'Posts do X usam Grok/xAI com busca nativa no X. Vazio = tenta análise pela extração de mídia quando houver mídia pública.',
  'setup.operation.title': 'Operação da instância',
  'setup.operation.description':
    'Ajustes de operação que não são modelos: identificação do bot, timeout de resumo e resiliência da extração de mídia.',
  'setup.operation.adminEmail': 'Email do operador',
  'setup.operation.adminEmailHint': 'Usado no header From do scraper quando configurado.',
  'setup.operation.summaryTimeout': 'Timeout de resumo',
  'setup.operation.summaryTimeoutHint': 'Em segundos. Vazio usa o padrão do serviço.',
  'setup.operation.mediaExtraction': 'Extração de mídia',
  'setup.operation.mediaExtractionHint':
    'Em deploys home-lab (IP residencial) o YouTube praticamente não bloqueia downloads. Em VPS é comum cair em soft-block: configure um proxy residencial próprio abaixo ou use o upload manual quando precisar.',
  'setup.operation.proxy': 'Proxy de extração (opcional)',
  'setup.operation.proxyConfigured': 'Proxy configurado',
  'setup.operation.proxyHint':
    'Uma URL por linha. Use apenas proxies controlados por você (próprios ou residenciais contratados). Vazio = sem proxy.',
  'setup.save': 'Salvar configurações',
  'setup.error.load': 'Erro ao carregar configuração.',
  'setup.error.key': 'Erro ao validar chave.',
  'setup.error.models': 'Erro ao listar modelos.',
  'setup.error.save': 'Erro ao salvar.',
} as const;

type I18nKey = keyof typeof ptBRMessages;

const enMessages: Record<I18nKey, string> = {
  'common.back': 'Back',
  'common.close': 'Close',
  'common.continue': 'Continue',
  'common.language': 'Language',
  'common.optional': 'optional',
  'common.saveContinue': 'Save and continue',

  'modelPicker.available': '{count} available',
  'modelPicker.clear': 'Do not configure',
  'modelPicker.clearHint': 'The feature stays disabled or uses its fallback.',
  'modelPicker.empty': 'No models found.',
  'modelPicker.filter': 'Filter by name, provider, or ID',
  'modelPicker.notConfigured': 'Not configured',
  'modelPicker.select': 'Select a model',
  'modelPicker.total': '{count} models available',

  'auth.email': 'Email',
  'auth.password': 'Password',
  'auth.passwordConfirm': 'Confirm password',
  'auth.passwordMin': 'Minimum 12 characters',
  'auth.name': 'Name',
  'auth.namePlaceholder': 'How you prefer to be called',
  'auth.emailPlaceholder': 'you@example.com',
  'auth.signIn': 'Sign in',
  'auth.signInTitle': 'Welcome back',
  'auth.signInSubtitle': 'Access your transcribed video library.',
  'auth.signInError': 'Incorrect email or password.',
  'auth.unexpectedError': 'Unexpected error. Try again.',
  'auth.noAccount': 'Do not have an account yet?',
  'auth.createAccount': 'Create account',
  'auth.signupsClosed': 'New signups are closed on this instance',
  'auth.firstRunTitle': 'First time here',
  'auth.firstRunSubtitle':
    'No users exist yet. Create the primary account. It will be the administrator for this instance.',
  'auth.createAdmin': 'Create admin account',
  'auth.heroTitle.prefix': 'Your video library,',
  'auth.heroTitle.highlight': 'ready for questions.',
  'auth.heroSubtitle':
    'Paste a link, Voxen transcribes and indexes it. Then chat with your library like a teammate who already watched everything.',
  'signup.titleFirst': 'Create primary account',
  'signup.titleDefault': 'Create a Voxen account',
  'signup.subtitleFirst': 'This will be the administrator account for the instance.',
  'signup.subtitleDefault': 'You can use the platform after an administrator approves you.',
  'signup.passwordTooShort': 'Password must be at least 12 characters.',
  'signup.passwordMismatch': 'Passwords do not match.',
  'signup.submitFirst': 'Create and configure',
  'signup.submitDefault': 'Create account',
  'signup.hasAccount': 'Already have an account?',
  'signup.strength.weak': 'Weak',
  'signup.strength.fair': 'Fair',
  'signup.strength.good': 'Good',
  'signup.strength.strong': 'Strong',

  'onboarding.language.eyebrow': '01 · Language',
  'onboarding.language.title': 'Choose the platform language',
  'onboarding.language.sub':
    'The interface changes immediately and the choice is saved for this instance when onboarding is completed.',
  'onboarding.language.ptHint': 'Project and documentation primary language.',
  'onboarding.language.enHint': 'English interface foundation for open-source users.',
  'onboarding.connection.eyebrow': '02 · Connection',
  'onboarding.connection.title': 'Connect OpenRouter',
  'onboarding.connection.sub':
    'One key gives access to transcription models (Whisper) and the agent that chats with your library.',
  'onboarding.keyCta': 'No key yet? Generate one now',
  'onboarding.validateContinue': 'Validate and continue',
  'onboarding.models.eyebrow': '03 · Models',
  'onboarding.models.title': 'Choose default models',
  'onboarding.models.sub':
    'Whisper Large Turbo is the best cost/quality option for transcription. For chat, prefer large-context models.',
  'onboarding.models.transcription': 'Transcription',
  'onboarding.models.chat': 'Chat',
  'onboarding.models.web': 'Web search',
  'onboarding.models.webHint':
    'Used by the web_search tool with the :online suffix. Empty = use the chat model.',
  'onboarding.models.vision': 'Vision',
  'onboarding.models.visionHint':
    'Enables image uploads in chat and Telegram. Empty = feature disabled.',
  'onboarding.models.documents': 'Documents',
  'onboarding.models.documentsHint':
    'OpenRouter models with native file/PDF input. Empty = document analysis disabled.',
  'onboarding.models.x': 'X / Grok',
  'onboarding.models.xHint': 'Analyzes X posts and threads with Grok/xAI and native X search.',
  'onboarding.mode.eyebrow': '04 · Usage mode',
  'onboarding.mode.title': 'Who will use this instance?',
  'onboarding.mode.sub': 'You can change this later in the administrative settings.',
  'onboarding.mode.team': 'Team',
  'onboarding.mode.teamDesc': 'Allow other users to sign up (you approve each one).',
  'onboarding.mode.solo': 'Only you',
  'onboarding.mode.soloDesc': 'Close new signups. Nobody else can create an account.',
  'onboarding.profile.eyebrow': '05 · Profile (optional)',
  'onboarding.profile.title': 'Make it yours',
  'onboarding.profile.sub': 'Add a photo if you want, or skip and finish now.',
  'onboarding.profile.upload': 'Upload image',
  'onboarding.profile.fileHint': 'PNG, JPG, or WebP up to 5MB',
  'onboarding.profile.finish': 'Finish',
  'onboarding.done.title': 'All set, {name}.',
  'onboarding.done.sub': 'Taking you to the dashboard…',
  'onboarding.error.key': 'Error validating key.',
  'onboarding.error.save': 'Error saving configuration.',
  'onboarding.error.avatar': 'Error uploading image.',
  'onboarding.error.finish': 'Error finishing onboarding.',

  'setup.badge.initial': 'Initial setup',
  'setup.badge.edit': 'Settings',
  'setup.title.initial': 'Connect OpenRouter',
  'setup.title.edit': 'Instance settings',
  'setup.subtitle.initial':
    'An OpenRouter key gives access to Whisper for transcription and several chat models. It is Voxen’s only external dependency.',
  'setup.subtitle.edit': 'Edit the key, default models, operation settings, and media extraction.',
  'setup.step.key': 'Key',
  'setup.step.models': 'Models',
  'setup.validationTitle': 'Could not validate',
  'setup.saved': 'Settings saved.',
  'setup.doneTitle': 'Saved.',
  'setup.doneSubtitle': 'Configuration updated. Taking you to the dashboard…',
  'setup.language.title': 'Platform language',
  'setup.language.description':
    'Defines the default UI language for this instance. The change is applied immediately and persisted when you save.',
  'setup.openrouter.title': 'OpenRouter',
  'setup.openrouter.description.active':
    'The saved key remains encrypted. Paste a new one only when you want to replace it.',
  'setup.openrouter.description.new': 'The validated key will be saved with the selected models.',
  'setup.openrouter.active': 'Active key',
  'setup.openrouter.stored': 'Key stored and ready to use.',
  'setup.openrouter.newKey': 'New OpenRouter API key (optional)',
  'setup.openrouter.apiKey': 'OpenRouter API key',
  'setup.openrouter.refreshModels': 'Refresh models',
  'setup.openrouter.refreshHint.active':
    'Refreshing models validates the typed key; if the field is empty, it uses the saved instance key.',
  'setup.openrouter.refreshHint.new':
    'Refreshing models revalidates the typed key before loading the catalog.',
  'setup.models.title': 'Default models',
  'setup.models.description':
    'Choose the models this instance uses for chat, transcription, vision, documents, web search, and X analysis.',
  'setup.models.transcription': 'Transcription model',
  'setup.models.chat': 'Chat model',
  'setup.models.web': 'Web search model (optional)',
  'setup.models.webHint':
    'The web_search tool uses this model with the :online suffix (Perplexity plugin). Empty = use the chat model.',
  'setup.models.vision': 'Vision model (optional)',
  'setup.models.visionHint':
    'For understanding images sent in chat. Empty = uploads stay disabled.',
  'setup.models.documents': 'Document/PDF model (optional)',
  'setup.models.documentsHint':
    'Filtered by OpenRouter models with native file/PDF input. Empty = document uploads stay disabled.',
  'setup.models.x': 'X analysis model (Grok)',
  'setup.models.xHint':
    'X posts use Grok/xAI with native X search. Empty = tries media extraction analysis when public media is available.',
  'setup.operation.title': 'Instance operation',
  'setup.operation.description':
    'Non-model settings: bot identification, summary timeout, and media extraction resilience.',
  'setup.operation.adminEmail': 'Operator email',
  'setup.operation.adminEmailHint': 'Used in the scraper From header when configured.',
  'setup.operation.summaryTimeout': 'Summary timeout',
  'setup.operation.summaryTimeoutHint': 'In seconds. Empty uses the service default.',
  'setup.operation.mediaExtraction': 'Media extraction',
  'setup.operation.mediaExtractionHint':
    'On home-lab deployments (residential IP), YouTube rarely blocks downloads. On VPS hosts, soft-blocks are common: configure your own residential proxy below or use manual upload when needed.',
  'setup.operation.proxy': 'Extraction proxy (optional)',
  'setup.operation.proxyConfigured': 'Proxy configured',
  'setup.operation.proxyHint':
    'One URL per line. Use only proxies you control (owned or contracted residential proxies). Empty = no proxy.',
  'setup.save': 'Save settings',
  'setup.error.load': 'Error loading configuration.',
  'setup.error.key': 'Error validating key.',
  'setup.error.models': 'Error listing models.',
  'setup.error.save': 'Error saving.',
};

const messages: Record<Locale, Record<I18nKey, string>> = {
  'pt-BR': ptBRMessages,
  en: enMessages,
};

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: I18nKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function normalizeLocale(value: string | null | undefined): Locale {
  return value === 'en' ? 'en' : 'pt-BR';
}

export function I18nProvider({ children }: { children: ReactNode }): ReactElement {
  const [locale, setLocaleState] = useState<Locale>(() => {
    try {
      return normalizeLocale(window.localStorage.getItem(STORAGE_KEY));
    } catch {
      return 'pt-BR';
    }
  });

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(normalizeLocale(next));
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === 'pt-BR' ? 'pt-BR' : 'en';
    try {
      window.localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // localStorage pode estar indisponível em modos privados/restritos.
    }
  }, [locale]);

  const t = useCallback(
    (key: I18nKey, vars?: Record<string, string | number>): string => {
      const template = messages[locale][key] ?? messages['pt-BR'][key] ?? key;
      if (!vars) return template;
      return template.replace(/\{(\w+)\}/g, (match, varName: string) => {
        const value = vars[varName];
        return value === undefined ? match : String(value);
      });
    },
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error('useI18n deve ser usado dentro de I18nProvider.');
  }
  return value;
}
