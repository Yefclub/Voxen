# Segurança — Voxen

Voxen é self-hosted e voltada a adoção restrita. O responsável pelo deploy
controla host, secrets, modelos, provedores de identidade e aprovação de
usuários. Vulnerabilidades devem seguir [`../SECURITY.md`](../SECURITY.md).

## Modelo de ameaças

| Ameaça                 | Vetor                      | Mitigação                                      |
| ---------------------- | -------------------------- | ---------------------------------------------- |
| Brute force            | endpoints de login         | rate limits, hash forte e IdP opcional         |
| SSRF                   | URL de ingestão maliciosa  | validação e allowlist antes da extração        |
| Acesso entre usuários  | identificador forjado      | `userId` sempre derivado da sessão             |
| Escalada de privilégio | rotas administrativas      | guards server-side por role                    |
| Vazamento de secrets   | dump ou log                | settings cifrados e logs sem valores sensíveis |
| Supply chain           | pacotes, Actions e imagens | lockfiles, audits, CodeQL, Trivy e gitleaks    |

## Autenticação e autorização

Better Auth mantém sessões em banco e cookies HTTP-only. Email/senha local está
sempre disponível. O administrador pode configurar um provedor OIDC, restringir
domínios e controlar aprovação automática de identidades confiáveis.

A primeira conta vira administradora. As demais contas locais começam
pendentes. Estados: `PENDING`, `APPROVED`, `REJECTED` e `DISABLED`.

Configurações da instância ficam em `/admin/*`. Perfil, sessões de contas de
plataforma e credenciais MCP pertencem ao usuário autenticado em `/conta/*`.

## Isolamento de usuários

- Derivar `userId` da sessão, nunca de body ou query.
- Filtrar transcrições, notas, jobs, grafo, custos, conversas, integrações e
  ferramentas do agente por esse `userId`.
- Manter visões globais do admin explícitas e protegidas.
- Compartilhar modelos da plataforma sem compartilhar dados ou sessões de
  contas pessoais.

## Secrets

Secrets de infraestrutura ficam somente no `.env` da raiz. Chaves OpenRouter,
OIDC e outros settings de aplicação são cifrados com AES-256-GCM usando
`MASTER_KEY`.

```bash
openssl rand -base64 32
```

Faça backup separado da master key. Nunca registre senhas, chaves, tokens,
cookies ou a master key.

## Segurança de rede e conteúdo

- O web é a única aplicação exposta.
- Subprocessos do worker usam arrays de argumentos, timeout, diretórios
  isolados e nunca interpolação de shell.
- URLs remotas são validadas antes das ferramentas de mídia.
- Storage local rejeita chaves absolutas/traversal e symlinks, usa permissões
  restritivas, escrita atômica e nunca é servido como diretório estático público.
- Credenciais S3 opcionais devem acessar somente o bucket da Voxen.
- O proxy residencial opcional usa TLS, token cifrado de alta entropia e SOCKS
  vinculado somente ao localhost.

## Segurança no CI

PRs e rotinas agendadas cobrem Dependency Review, CodeQL, Trivy, audits Python
e pnpm, gate de migrations Prisma e gitleaks. Tokens de workflows usam leitura
por padrão; cada job solicita apenas permissões necessárias.

### Exceção temporária de dependência

O advisory React Router `GHSA-qwww-vcr4-c8h2` afeta React Server Components
instáveis. Voxen usa Vite com `BrowserRouter` e não usa React Server Components;
o finding é aceito como não aplicável até existir release compatível corrigida.
Responsável: maintainers. Revisão: 2026-09-01.

Nenhum outro advisory high ou critical de produção pode ser ignorado sem
escopo, responsável e data de revisão.

## Resposta a incidentes

1. Rotacionar credenciais afetadas de host, aplicação, OIDC e modelos.
2. Revogar sessões e desabilitar contas comprometidas.
3. Auditar eventos de autenticação, jobs, automações e custos.
4. Restaurar backups do Postgres, storage e `MASTER_KEY` quando necessário.
5. Publicar patch e comunicar o impacto pela política de segurança.
