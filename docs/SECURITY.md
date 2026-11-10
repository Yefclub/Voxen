# Segurança — Voxen

Voxen é self-hosted e voltada a adoção restrita. O responsável pelo deploy
controla host, secrets, modelos, provedores de identidade e aprovação de
usuários. Vulnerabilidades devem seguir [`../SECURITY.md`](../SECURITY.md).

## Modelo de ameaças

| Ameaça                 | Vetor                      | Mitigação                                      |
| ---------------------- | -------------------------- | ---------------------------------------------- |
| Brute force            | endpoints de login         | rate limits, hash forte e IdP opcional         |
| SSRF                   | URL de captura maliciosa   | checagem no submit e saída só pelo Smokescreen |
| Prompt injection       | página ou post capturado   | interpretação sem ferramentas e com schema     |
| Vazamento de chave     | banco, logs, leituras      | chave por usuário cifrada, nunca devolvida     |
| Share forjado          | POST de outro site         | exige sessão e recusa `Sec-Fetch-Site` externo |
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
- Filtrar transcrições, notas, jobs, grafo e custos por esse `userId`.
- Manter visões globais do admin explícitas e protegidas.
- Compartilhar configurações da plataforma sem compartilhar dados ou sessões de
  contas pessoais.

## Secrets

Secrets de infraestrutura ficam somente no `.env` da raiz, incluindo o
`CAPTURE_WORKER_TOKEN`, entregue só ao `web` e ao `capture-worker`. OIDC,
outros settings de aplicação e as chaves de provedor de IA de cada usuário são
cifrados com AES-256-GCM usando `MASTER_KEY`. A chave é informada na UI
(Conta → Provedores de IA), validada com uma chamada autenticada barata e
nunca devolvida a cliente nenhum: a leitura mostra só provedor, os quatro
últimos caracteres, status de validação e data.

```bash
openssl rand -base64 32
```

Faça backup separado da master key. Nunca registre senhas, chaves, tokens,
cookies ou a master key.

## Segurança de rede e conteúdo

- O web é a única aplicação exposta. O capture worker não publica portas,
  recusa requisições sem o bearer `CAPTURE_WORKER_TOKEN` e não tem
  `MASTER_KEY`, chave de provedor nem credencial de banco.
- O worker roda como usuário não-root, root filesystem somente leitura, todas
  as capabilities removidas, `no-new-privileges` e limites de CPU/memória. O
  yt-dlp roda com `--ignore-config --no-plugin-dirs --no-remote-components` e
  `--` antes da URL. Sem cookies, login, APIs pagas de scraping ou bypass
  anti-bot; plataforma bloqueada termina em `LOGIN_REQUIRED`, `IP_BLOCKED`,
  `RATE_LIMITED` ou `REMOVED` e sugere enviar o arquivo.
- SSRF: o submit recusa na hora URLs não http(s), `localhost` e endereços
  privados, loopback ou link-local literais (`BLOCKED_ADDRESS`). Depois, toda
  requisição do worker passa pelo Smokescreen, que bloqueia faixas privadas,
  loopback, link-local e de metadados após DNS e redirects; um link público
  que redireciona para dentro falha com `BLOCKED_ADDRESS`.
- Chamadas de modelo vão só para os endpoints fixos de OpenAI, Anthropic,
  OpenRouter, xAI e Google Gemini; não existe base URL customizada. A chave do
  Gemini vai só no header `x-goog-api-key`, nunca na URL.
- Prompt injection: a interpretação roda sem ferramentas, sem busca na web e
  com schema de saída estrito. Texto e imagens capturados entram como dados
  não confiáveis, e links e imagens são removidos do resumo gerado; uma página
  hostil no máximo distorce o próprio documento.
- O share target do PWA (`POST /share-target`) só cria jobs para usuário
  logado e aprovado, recusa `Sec-Fetch-Site` de outro site, não guarda nada
  sem sessão e redireciona só com ids ou códigos fixos de erro — texto
  compartilhado nunca vira HTML.
- Storage local rejeita chaves absolutas/traversal e symlinks, usa permissões
  restritivas, escrita atômica e nunca é servido como diretório estático público.
- Credenciais S3 opcionais devem acessar somente o bucket da Voxen.
- Âncoras são verificadas contra a fonte canônica do usuário e preservam
  versão/checksum; IDs pertencentes a outra pessoa permanecem ocultos.
- Pesquisa externa é não confiável e exige revisão. Saída sem citação falha de
  forma fechada, sugestões ou stale ficam fora da recuperação e o Markdown não
  habilita HTML cru nem URLs inseguras.
- O conteúdo bruto da fonte aparece somente no planejamento sem ferramentas.
  Validação determinística de consultas o separa das buscas com ferramenta;
  tetos de preço, limites de requisições/resultados, prova estrita de uso e
  prazo total fazem o fluxo falhar fechado antes de entrar no conhecimento.
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

1. Rotacionar credenciais afetadas de host, aplicação, OIDC,
   `CAPTURE_WORKER_TOKEN` e provedores (cada usuário troca a própria chave em
   Conta → Provedores de IA).
2. Revogar sessões e desabilitar contas comprometidas.
3. Auditar eventos de autenticação, jobs, automações e custos.
4. Restaurar backups do Postgres, storage e `MASTER_KEY` quando necessário.
5. Publicar patch e comunicar o impacto pela política de segurança.
