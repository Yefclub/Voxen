# 060 — Validação de APP_BASE_URL (fail-fast, sem loop de crash)

## Contexto

Em servidores novos, quando `APP_BASE_URL` é configurado malformado — por
exemplo `"https://"` (só esquema, sem host) — o better-auth crasha no boot com
`Invalid base URL`. A web sai com status 1 e, sob o supervisor do Easypanel/Swarm,
a stack reinicia em **loop infinito** com um erro críptico que não aponta a causa
real (env mal configurada).

Causa direta: `apps/web/src/lib/auth.ts` usava
`baseURL: process.env.APP_BASE_URL ?? 'http://localhost:3000'`. O operador `??`
só substitui `undefined`/`null`, nunca uma string não-vazia porém inválida.

Esta entrega adiciona **fail-fast com mensagem clara no entrypoint** (antes de
qualquer serviço subir) e **defesa em profundidade no auth** (não propagar o erro
críptico do better-auth, caindo num fallback seguro). É um fix de DX self-hosted:
o operador descobre o erro em segundos, não em um loop de logs ilegíveis.

## Glossário

- **APP_BASE_URL**: URL pública base do deploy (ex.: `https://voxen.exemplo.com`),
  usada pelo better-auth para montar callbacks/cookies.
- **Entrypoint**: `scripts/easypanel-entrypoint.sh`, processo de boot da imagem
  combinada `voxen-app` que sobe web, chat e worker.
- **Malformado**: sem esquema `http`/`https`, ou com esquema porém sem host
  (ex.: `https://`, `https:///path`, `ftp://host`, `notaurl`, string vazia).

## Requisitos (EARS)

### R1 — Fail-fast no entrypoint

- **R1.1** When o entrypoint inicia e `APP_BASE_URL` está ausente, the entrypoint
  shall abortar com `exit 1` e mensagem indicando que a variável é obrigatória
  (comportamento já existente via `require_env`).
- **R1.2** When `APP_BASE_URL` está definido mas é malformado (sem esquema
  http/https OU com esquema sem host), the entrypoint shall imprimir uma mensagem
  clara contendo o valor recebido e um exemplo válido
  (`https://voxen.seudominio.com`) e abortar com `exit 1` **antes** de iniciar
  web, chat ou worker.
- **R1.3** When `APP_BASE_URL` é uma URL http/https válida com host não-vazio,
  the entrypoint shall prosseguir o boot normalmente sem alterar o valor.
- **R1.4** The entrypoint shall validar usando apenas shell (sem depender de
  node/python), para não acoplar a validação ao runtime que ela protege.

### R2 — Defesa em profundidade no auth

- **R2.1** When `process.env.APP_BASE_URL` é uma URL http/https válida com host,
  the módulo de auth shall usá-la como `baseURL` sem modificação.
- **R2.2** When `APP_BASE_URL` está ausente OU é malformado, the módulo de auth
  shall logar um `console.error` claro e cair no fallback `http://localhost:3000`,
  **sem** lançar exceção que derrube o processo.
- **R2.3** The lógica de resolução do baseURL shall ser exposta como função pura
  testável (`resolveAuthBaseURL`).

## Casos de aceite

| Entrada                | Entrypoint | `resolveAuthBaseURL` |
|------------------------|------------|----------------------|
| `https://voxen.com`    | prossegue  | `https://voxen.com`  |
| `http://localhost:3000`| prossegue  | `http://localhost:3000` |
| `https://`             | exit 1     | fallback             |
| `https:///path`        | exit 1     | fallback             |
| `ftp://host`           | exit 1     | fallback             |
| `notaurl`              | exit 1     | fallback             |
| (vazio/ausente)        | exit 1*    | fallback             |

\* ausente é barrado por `require_env` (R1.1); vazio também.

## Fora de escopo

- Validar outras envs (DATABASE_URL etc.) além do que já existe.
- Normalizar/canonicalizar a URL (trailing slash, lowercase host).
- Mudanças no fluxo de boot além de adicionar a validação.
