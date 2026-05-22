# Spec 017 — Documentação Bilíngue e Idioma da Plataforma

## Contexto

Voxen está em fase de abertura para open source. A documentação atual é boa para
operadores PT-BR, mas o repositório público precisa acolher contribuidores e
usuários que leem inglês. Ao mesmo tempo, a plataforma deve continuar com foco
primário em PT-BR e começar a oferecer uma experiência em inglês de forma
incremental.

Esta spec cria a base bilíngue:

- documentação pública com índice PT-BR/EN e guias em inglês;
- runtime de i18n no frontend com PT-BR como idioma padrão;
- escolha de idioma no onboarding inicial;
- persistência do idioma da instância para futuras telas.

## Glossário

- **Idioma da instância**: preferência global salva em `Setting` sob a chave
  `app_language`.
- **Idioma local**: preferência em `localStorage`, usada antes da instância
  estar configurada e para refletir a escolha imediatamente na UI.
- **Locale suportado**: `pt-BR` ou `en`.
- **Documentação canônica PT-BR**: documentação existente na raiz e em
  `docs/*.md`.
- **Documentação EN**: guias equivalentes em `docs/en/*.md`.

## Requisitos

### Ubiquitous

- The system shall keep `pt-BR` as the default locale for product UI.
- The system shall support `en` as an initial secondary locale.
- The system shall persist the global platform language in `Setting` using
  `app_language`.
- The documentation shall expose clear navigation between PT-BR and English.

### Event-driven

- When an administrator starts onboarding, the system shall ask which language
  they want to use before requesting the OpenRouter key.
- When the administrator selects a language during onboarding, the UI shall
  switch immediately without waiting for backend persistence.
- When onboarding is finished, the system shall persist the selected language
  together with the onboarding completion state.
- When an administrator edits instance setup later, the system shall allow
  changing the platform language.

### State-driven

- While no language is persisted yet, the frontend shall use `localStorage` if
  present; otherwise it shall use `pt-BR`.
- While the backend returns a valid `app_language`, the frontend shall sync the
  local runtime locale to that value.

### Complemento de Cobertura Interna

- The system shall render the main authenticated web surfaces through the i18n
  runtime: dashboard, chat, jobs, library, notes, graph, automations, account,
  setup and admin pages.
- The system shall keep PT-BR as canonical copy and provide English strings for
  the initial open-source UI experience.
- The system shall keep user-generated content, model/provider names, external
  service names and persisted automation prompts untranslated.

### Unwanted

- If an unsupported locale is submitted to the backend, then the system shall
  reject the payload with HTTP 400.
- If a persisted language is invalid or missing, then the system shall fall back
  to `pt-BR`.
- If docs are read from the repository root, then users shall be able to find
  both the PT-BR canonical docs and the English docs without guessing paths.

## Critérios de Aceite

- [x] `GlobalSettingKey` aceita `app_language`.
- [x] `/api/instance`, `GET /api/setup`, `POST /api/setup` e
      `POST /api/onboarding` expõem/aceitam idioma suportado.
- [x] O frontend possui provider/hook de i18n com dicionários `pt-BR` e `en`.
- [x] O onboarding possui uma etapa inicial de idioma e persiste a escolha.
- [x] A tela de setup permite alterar o idioma da instância.
- [x] O fluxo inicial em inglês cobre onboarding/login/cadastro ou, no mínimo,
      as superfícies necessárias para chegar ao onboarding sem texto crítico em
      PT-BR.
- [x] `README.md` aponta claramente para documentação PT-BR e EN.
- [x] `docs/README.md` funciona como índice bilíngue.
- [x] `docs/en/*.md` contém guias em inglês para arquitetura, deploy,
      desenvolvimento, stack, segurança, decisões e formato de transcrição.
- [x] Validações web passam: lint, typecheck, test, format-check e build.
- [x] Fluxos internos centrais foram conectados ao i18n em PRs complementares.
- [x] Páginas admin, conta, automações e grafo usam dicionário PT-BR/EN.

## Fora de Escopo

- Tradução dinâmica de conteúdo criado pelo usuário.
- Preferência de idioma por usuário individual.
- Migração SQL para backfill de `app_language`; ausência da setting usa
  fallback `pt-BR`.
- Tradução de mensagens do chat/worker Python.

## Riscos / Decisões

- Risco: traduzir a aplicação inteira numa única PR tornaria revisão e regressão
  difíceis. Decisão: entregar fundação sólida e cobrir o onboarding/entrada
  agora, mantendo as demais telas em PT-BR até PRs específicas.
- Risco: idioma global pode não atender times mistos. Decisão: `app_language`
  global é suficiente para single-tenant self-hosted; idioma por usuário fica
  para evolução futura.
