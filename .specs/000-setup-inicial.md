# Spec 000 — Setup Inicial

> **2026-08-07 amendment (supersedes mandatory S3 requirements below):** New
> single-host installs shall use `STORAGE_DRIVER=local` and the shared
> `/data/storage` volume. When any non-empty legacy `S3_*`/`GARAGE_*` value is
> present without a driver, the system shall preserve S3 and fail closed on
> partial configuration. Bucket creation applies only to the opt-in S3 profile.

## Contexto

Voxen é uma plataforma web multi-user com adoção restrita. O **primeiro user** que se cadastrar precisa virar admin automaticamente e configurar o sistema (cola OpenRouter API key + escolhe modelos default) antes que qualquer outro user possa entrar. Cadastros subsequentes ficam pendentes até o admin aprovar.

Esta spec cobre toda a inicialização: configuração da master key, criação do bucket S3-compatible (MinIO no padrão local/Easypanel), aplicação de migrations, criação do primeiro admin, tela de setup, fluxo de cadastro/aprovação.

Referências: `docs/ARCHITECTURE.md` (fluxos), `docs/SECURITY.md` (master key, secrets cifrados), ADR-007 (better-auth + aprovação), ADR-008 (master key auto-gerada).

## Glossário

- **Setup**: estado inicial onde admin precisa preencher `openrouter_api_key` e modelos default antes do sistema ficar operacional
- **Admin**: user com `role=ADMIN` (primeiro cadastrado)
- **User comum**: `role=USER`
- **Pendente**: `status=PENDING` — não pode logar
- **Aprovado**: `status=APPROVED` — pode logar
- **Workspace**: escopo de dados de um user; identificado por `userId`
- **Master key**: chave AES-256 em `MASTER_KEY` no `.env`/env do deploy, em base64 de 32 bytes, usada pra cifrar `settings.valueEnc`

## Requisitos

### Ubiquitous (sempre verdadeiros)

- The documented install modes shall configure the master key via `MASTER_KEY`, 32 random bytes encoded as base64 (`openssl rand -base64 32`).
- The local dev flow shall create/complete `.env` without overwriting existing secrets, including `MASTER_KEY` and S3/MinIO variables.
- The system shall create the S3-compatible bucket `voxen-transcripts` on first boot if absent (MinIO in the default local/Easypanel flow), using `S3_*` credentials from env.
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
- **If** `MASTER_KEY` is missing or invalid in a documented install mode, the app shall exit with non-zero code and log a fatal master-key error.
- **If** required S3 credentials (`S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`) are missing when an app starts or performs storage IO, the operation shall fail explicitly.
- **If** the Prisma migrations fail to apply, the `apps/web` container shall exit and **not** serve traffic.

## Critérios de Aceite

- [ ] `docker compose up -d` sobe sem intervenção manual em ambiente limpo
- [ ] `.env` local é criado/completado com `MASTER_KEY` no primeiro `make dev`
- [ ] Em re-boot, `MASTER_KEY` existente NÃO é sobrescrita
- [ ] Bucket `voxen-transcripts` é criado no MinIO/S3 no primeiro boot
- [ ] Em re-boot, bucket existente NÃO é recriado
- [ ] Variáveis `S3_ACCESS_KEY` e `S3_SECRET_KEY` válidas são usadas por web/chat/worker
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
> 2026-05-16: PR `feat/master-key-crypto` adiciona biblioteca de cifragem AES-256-GCM em TS (`apps/web/src/lib/crypto.ts`) e Python (`apps/{chat,worker}/src/voxen_crypto.py`). Formato compartilhado `iv.ciphertext.tag` em base64. Cobre os requisitos ubiquitous "store all runtime secrets cifrados via AES-256-GCM" e unwanted "master key file missing → exit". 17 testes Bun + 17 testes pytest (chat e worker), cross-compat de formato documentado.
> 2026-05-16: PR `feat/auth-basic` adiciona better-auth (email+senha) com `prismaAdapter`. Endpoints `/api/auth/*` (sign-up, sign-in, sign-out) + `/api/me`. SEM workflow de aprovação ainda — `status`/`role` mostrados como additionalFields placeholder, validação de status virá na PR seguinte. Generator Prisma migra pro novo `prisma-client` (output em `apps/web/prisma-generated/`) pra contornar bug de auto-install do `prisma-client-js` em workspaces pnpm.
> 2026-05-16: PR `feat/admin-approval` cumpre os event-driven "primeiro cadastro vira ADMIN+APPROVED", "demais ficam PENDING", "login PENDING/REJECTED/DISABLED retorna 403". Adiciona `/api/admin/usuarios` (listar) + `/api/admin/usuarios/:id/approve` + `/api/admin/usuarios/:id/reject`, guard de role ADMIN no router. `/api/me` agora expõe status+role. CI test-ts ganha service postgres + `prisma migrate deploy`. 7 testes integration validam o fluxo completo (signup→pending→admin aprova→login OK).
> 2026-05-16: PR `feat/setup-form` cobre o **backend do setup inicial**: endpoints `/api/setup` (GET status, POST salvar, POST `/models` preview), validação real da OpenRouter (`GET /api/v1/key`), persistência cifrada em `Setting` (scope=GLOBAL, AES-256-GCM via master key). `/api/me` agora expõe `setupComplete`. Cumpre os event-driven "admin submete setup → valida → persiste cifrado" e "key inválida → 400 + nada persiste" + unwanted "master key ausente → fatal". Cobre o requirement ubiquitous "store all runtime secrets cifrados". 5 testes integration novos (admin OK, key inválida, user comum 403, não-autenticado 401, /api/me reflete setupComplete). CI ganhou geração de master key efêmera (`openssl rand -base64 32`) antes dos testes; `bunfig.toml` com preload garante master key local. **UI da `/setup` (Vite + React + shadcn) fica em PR separado** — apps/web ainda é só Hono API; scaffolding do front virá quando a base houver a primeira tela.
> 2026-05-19: Padrão de instalação atualizado para `MASTER_KEY` via `.env`/env em todos os modos documentados e MinIO/S3-compatible como storage padrão local/Easypanel. `MASTER_KEY_PATH` e credenciais `GARAGE_*` ficam apenas como compatibilidade legada no código, não como caminho de instalação novo.
