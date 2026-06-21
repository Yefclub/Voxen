# 060 — Login rápido por QR code (handoff de sessão cross-device)

## Contexto

O usuário, logado no desktop, quer entrar rapidamente em um novo device (celular)
sem digitar email/senha. A página de Conta (`/conta`) exibe um QR code; o celular
escaneia, abre uma URL de login e ganha acesso ao app logado como o mesmo usuário.

Padrão escolhido: **token de uso único, curta duração** (one-time token).

## Pesquisa de biblioteca (Bibliotecas primeiro — CLAUDE.md)

O `better-auth` (1.6.11, já em uso) tem o **plugin oficial `oneTimeToken`**
(`better-auth/plugins/one-time-token`). Auditando o source instalado
(`node_modules/.pnpm/better-auth@1.6.11/.../plugins/one-time-token/index.mjs`):

- `generateOneTimeToken` é um endpoint `GET /one-time-token/generate` protegido por
  `sessionMiddleware` — **só uma sessão válida gera token**. Deriva a sessão do
  cookie, nunca de body/query.
- O token é `generateRandomString(32)` (alta entropia, 32 chars do alfabeto seguro).
- O token é guardado em `verificationValue` com `expiresAt` (TTL). Default 3 min;
  configuramos **60s** via `expiresIn` (em minutos → `1`).
- `verifyOneTimeToken` (`POST /one-time-token/verify`):
  1. `findVerificationValue` pelo identifier;
  2. **`deleteVerificationByIdentifier` ANTES de checar expiração** → single-use
     real (mesmo token expirado é invalidado no 1º toque, sem replay);
  3. valida expiração;
  4. `findSession(...)` da sessão atrelada;
  5. `setSessionCookie(c, session)` → seta o cookie no device que verificou.

Suporta `storeToken: 'hashed'` — guardamos o **hash** do token no DB (defesa em
profundidade: dump de DB não revela tokens utilizáveis).

### Decisão: plugin oficial vs. manual

**Usar o plugin oficial.** Mais seguro e manutenível que rolar token + criar sessão
programaticamente à mão (criação manual de sessão no better-auth exige
`internalAdapter.createSession` + `setSessionCookie` dentro de `createAuthEndpoint`,
sem garantia de estabilidade entre versões). O plugin cobre entropia, TTL,
single-use e set-cookie.

### Trade-off conhecido (documentado)

O plugin **reusa a sessão do desktop** — o celular passa a compartilhar o mesmo
`session.token`. Não cria sessão independente. Implicações:

- Revogar a sessão do desktop derruba o celular.
- A expiração da sessão é a do desktop (30 dias no Voxen).
- Aceitável para Voxen (self-hosted, single-tenant): o handoff é "entrar como você
  neste device", e o trade-off de "quem escaneia entra" já é inerente ao recurso.

O `databaseHooks.session.create.before` (que bloqueia não-APPROVED) **não roda** no
verify, porque nenhuma sessão nova é criada. Isso é correto: a sessão do desktop já
passou por essa checagem ao ser criada; só um usuário já-aprovado tem sessão para
gerar o token.

## Requisitos (EARS)

### Geração (desktop autenticado)

- **REQ-1** — Quando um usuário autenticado solicita um QR de login, o sistema
  DEVE gerar um one-time token derivando o `userId`/sessão do cookie (nunca do body).
- **REQ-2** — Quando um cliente não autenticado solicita geração, o sistema DEVE
  responder 401.
- **REQ-3** — O sistema DEVE retornar a URL de consumo
  `<APP_BASE_URL>/qr-login?t=<token>` e o TTL em segundos, **sem logar o token**.
- **REQ-4** — Enquanto a geração é solicitada repetidamente, o sistema DEVE aplicar
  rate-limit por usuário (Redis) para evitar flood de tokens.
- **REQ-5** — O token DEVE ter TTL curto (60s) e ser armazenado de forma hasheada.

### Consumo (mobile)

- **REQ-6** — Quando o token é verificado pela primeira vez, o sistema DEVE
  invalidá-lo imediatamente (single-use) e estabelecer a sessão no device.
- **REQ-7** — Quando um token é reutilizado (2ª vez), o sistema DEVE falhar (token
  inválido).
- **REQ-8** — Quando um token expirado é apresentado, o sistema DEVE falhar com
  mensagem clara e oferecer link para o login normal.
- **REQ-9** — A página `/qr-login` DEVE ser responsiva (mobile-first), funcionar sem
  sessão prévia, e redirecionar ao app logado em caso de sucesso.

### UI desktop

- **REQ-10** — A página de Conta DEVE ter um card "Login rápido (QR)" com: botão
  para gerar, render do QR, countdown do TTL, botão de regenerar e aviso de
  segurança ("trate como senha; quem escanear entra como você").
- **REQ-11** — Todas as strings DEVEM ter i18n pt-BR + en.

## Critérios de aceite (testes)

1. `GET /api/auth/one-time-token/generate` sem cookie → 401.
2. Com sessão válida → 200 com `{ token }`.
3. `POST /api/auth/one-time-token/verify` com token válido → 200 + Set-Cookie de
   sessão.
4. Reusar o mesmo token (2ª chamada) → erro (400).
5. Token expirado (TTL estourado) → erro (400).
6. O endpoint de geração (`/api/account/qr-login`) sem sessão → 401; com sessão →
   retorna `loginUrl` + `expiresInSec`, e o token NÃO aparece em log.

## Segurança

- Token alta entropia (32 chars), TTL 60s, single-use real, hasheado no DB.
- Geração exige sessão válida (server-side), userId nunca do cliente.
- Rate-limit por usuário na geração.
- Nunca logar o token nem a URL completa.
- Trade-off de account-takeover limitado ao já-conhecido (quem escaneia entra como
  o dono — equivalente a entregar a sessão). Sem novo vetor além disso.
