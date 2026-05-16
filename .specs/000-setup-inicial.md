# Spec 000 — Setup Inicial

## Contexto

Voxen é uma plataforma web multi-user com adoção restrita. O **primeiro user** que se cadastrar precisa virar admin automaticamente e configurar o sistema (cola OpenRouter API key + escolhe modelos default) antes que qualquer outro user possa entrar. Cadastros subsequentes ficam pendentes até o admin aprovar.

Esta spec cobre toda a inicialização: geração de master key, criação do bucket Garage, aplicação de migrations, criação do primeiro admin, tela de setup, fluxo de cadastro/aprovação.

Referências: `docs/ARCHITECTURE.md` (fluxos), `docs/SECURITY.md` (master key, secrets cifrados), ADR-007 (better-auth + aprovação), ADR-008 (master key auto-gerada).

## Glossário

- **Setup**: estado inicial onde admin precisa preencher `openrouter_api_key` e modelos default antes do sistema ficar operacional
- **Admin**: user com `role=ADMIN` (primeiro cadastrado)
- **User comum**: `role=USER`
- **Pendente**: `status=PENDING` — não pode logar
- **Aprovado**: `status=APPROVED` — pode logar
- **Workspace**: escopo de dados de um user; identificado por `userId`
- **Master key**: chave AES-256 em `/data/master.key` (volume) usada pra cifrar `settings.valueEnc`

## Requisitos

### Ubiquitous (sempre verdadeiros)

- The system shall generate a master key at `/data/master.key` on first boot if absent, 32 random bytes encoded as base64, chmod 0400.
- The system shall create the Garage bucket `voxen-transcripts` on first boot if absent, with a key `voxen-key` granted read+write+owner permissions, and write credentials to `/creds/voxen.env`.
- The system shall apply all pending Prisma migrations on `apps/web` startup before serving traffic.
- The system shall store all runtime secrets (OpenRouter API key, default models, SMTP config) cifrados via AES-256-GCM com a master key, in `Settings.valueEnc`.
- The system shall expose `/health` returning `200 OK` always, even before setup is complete.
- The system shall return `503 Service Unavailable` on any non-auth, non-setup, non-health route when setup is incomplete.

### Event-driven

- **When** a user submits the signup form **AND** `count(User) == 0`, the system shall create the user with `role=ADMIN`, `status=APPROVED`, `approvedAt=now()`, and `approvedBy=self`.
- **When** a user submits the signup form **AND** `count(User) > 0`, the system shall create the user with `role=USER`, `status=PENDING`, and `approvedAt=null`.
- **When** an approved admin user submits a setup form with `openrouter_api_key` (and optional model selections), the system shall validate the key against OpenRouter `/api/v1/key`, encrypt with master key, and persist in `Settings` (scope=GLOBAL) under keys `openrouter_api_key`, `default_chat_model`, `default_transcription_model`.
- **When** an admin user clicks "approve" on a pending user, the system shall set that user's `status=APPROVED`, `approvedAt=now()`, `approvedBy=<adminId>`, and optionally `monthlyBudgetUsd=<value>`.
- **When** a pending user attempts to sign in with correct credentials, the system shall reject the login with HTTP 403 and message `"Cadastro aguardando aprovação do administrador."`.
- **When** a rejected user attempts to sign in, the system shall reject the login with HTTP 403 and message `"Cadastro recusado. Entre em contato com o administrador."`.

### State-driven

- **While** setup is not complete (i.e., `Settings.GLOBAL.openrouter_api_key` is null), the system shall redirect every authenticated admin request to `/setup` regardless of original destination, except for `/api/setup` itself and `/api/auth/sign-out`.
- **While** setup is not complete **AND** the user is not the admin (no admin exists yet OR user is not approved), the system shall return `503 Service Unavailable` on every route except `/health`, `/api/auth/sign-up`, `/api/auth/sign-in`, and static assets needed for the signup page.
- **While** a user has `status=PENDING`, the system shall block all API access except `/api/auth/sign-out` and a read-only `/api/me` returning `{ status: 'pending' }`.

### Optional

- **Where** SMTP is configured (i.e., `Settings.GLOBAL.smtp_*` are non-null), the system shall send an email to the admin when a new user signs up with `status=PENDING`.
- **Where** SMTP is configured, the system shall send a notification email to the user when their status changes to `APPROVED` or `REJECTED`.

### Unwanted behavior

- **If** the OpenRouter API key validation fails during setup, the system shall reject the form with HTTP 400 and message `"Chave da OpenRouter inválida — verifique e tente novamente."`, and shall **not** persist any field of the form.
- **If** an unauthenticated request hits `/setup` or `/api/setup`, the system shall redirect (web) or return 401 (API).
- **If** a non-admin authenticated user requests `/setup` or `/api/setup`, the system shall return 403.
- **If** the master key file is missing or unreadable when an app starts, the app shall exit with non-zero code and log `"FATAL: master key not accessible at <path>"`.
- **If** the Garage credentials file `/creds/voxen.env` is missing when an app starts, the app shall exit with non-zero code.
- **If** the Prisma migrations fail to apply, the `apps/web` container shall exit and **not** serve traffic.

## Critérios de Aceite

- [ ] `docker compose up -d` sobe sem intervenção manual em ambiente limpo
- [ ] Master key é gerada em `/data/master.key` no primeiro boot e tem permissão `0400`
- [ ] Em re-boot, master key existente NÃO é regerada
- [ ] Bucket `voxen-transcripts` é criado no Garage no primeiro boot
- [ ] Em re-boot, bucket existente NÃO é recriado
- [ ] Arquivo `/creds/voxen.env` é populado com `GARAGE_ACCESS_KEY` e `GARAGE_SECRET_KEY` válidos
- [ ] Migrations Prisma aplicam no entrypoint do `apps/web`; container falha (exit non-zero) se migration der erro
- [ ] DB vazio + acesso a `/` redireciona pra `/cadastro`
- [ ] Cadastro do primeiro user retorna sucesso e o user é criado com `role=ADMIN, status=APPROVED`
- [ ] Login do admin após primeiro cadastro redireciona pra `/setup` (não `/dashboard`)
- [ ] `/setup` mostra form com campos `openrouter_api_key`, `default_chat_model` (select com lista), `default_transcription_model` (select)
- [ ] Submissão do setup com key inválida (mock: chave que retorna 401 na OR) → form mostra erro PT-BR, nada persiste
- [ ] Submissão do setup com key válida → settings persistidas cifradas (valueEnc base64 não-vazio, valuePlain == null), admin redirecionado pra `/dashboard`
- [ ] Após setup completo, segundo user que se cadastra fica com `status=PENDING`
- [ ] Login do user pendente retorna HTTP 403 com mensagem em PT-BR
- [ ] Admin vê user pendente em `/admin/usuarios` e botão "Aprovar"
- [ ] Clicar "Aprovar" muda status pra APPROVED, com `approvedAt` setado
- [ ] User aprovado consegue logar e cai em `/dashboard`
- [ ] `/health` retorna 200 em qualquer estado do sistema (mesmo antes do setup)
- [ ] Cobertura de testes: unit (lógica de scoping + cifragem), integration (signup flow + setup flow + approval flow), E2E Playwright do fluxo completo

## Fora de escopo

- Recuperação de senha (fase 2)
- SMTP notifications de fato (config exists na spec mas implementação real é fase 2)
- Rotação de master key
- 2FA
- Reset de admin (se admin perder senha)
- OAuth (Google/GitHub)
- Painel admin completo (só "aprovar" é MVP — bloqueio, alteração de budget, etc. virão em outra spec)

## Riscos / Decisões pendentes

- **Validação da OpenRouter key**: faremos chamada real a `/api/v1/key` na submissão do setup? Custo = 1 request por setup. **Decisão: sim, vale o custo pra evitar key inválida quebrar todo o sistema depois.**
- **Modelos default**: a lista de modelos é dinâmica (vem da OR `/api/v1/models?output_modalities=text` e `=transcription`). Cachear localmente por X horas? Decisão na implementação.
- **Rejeição de cadastro**: a spec menciona `REJECTED` mas o MVP da UI tem só "Aprovar"? Recomendo adicionar "Rejeitar" também — custo pequeno e completa o ciclo.
- **Budget mensal default**: ao aprovar, o admin define budget. Se não definir, sistema usa `null` = sem limite. Owner pediu "sem limite" no MVP — OK.
- **Aprovação em massa**: futuro — não MVP.

## Histórico

> 2026-05-15: spec inicial criada com a fundação do repo novo.
> 2026-05-16: PR `feat/db-migration-inicial` cumpre os critérios de aceite "migrations Prisma aplicam no entrypoint" e "FTS funcional". Adicionadas 2 migrations (`init` + `add_fts_trigger`) + `prisma/seed.ts` placeholder. Trigger `transcript_search_vector_update` + index GIN `Transcript_searchVector_idx` validados manualmente com `INSERT` + `plainto_tsquery('portuguese', ...)`.
