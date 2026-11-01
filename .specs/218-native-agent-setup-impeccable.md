# Spec 218 — Modernização do setup nativo de agentes e skills (Codex/Claude)

## Contexto

Ferramentas de desenvolvimento do Voxen (instruções, skills, agentes, hooks, CI)
precisam de configuração nativa por cliente, papéis verificáveis e instalação
reproduzível do Impeccable, sem importar pacote corporativo nem tocar ambiente
global do desenvolvedor. Baseline `dev` em `10270e3`. As issues #898 (spec 217)
e #900 seguem fluxo próprio; esta spec não autoriza mudança de aplicação.

Achados confirmados na árvore atual (verificação estática, sem execução):

- `CLAUDE.md` autoriza merge autônomo após review/CI e diz que todo merge
  exige confirmação — regra única por alvo (integração vs release) ausente.
- `.claude/agents/code-reviewer.md` exige comentário público em pt-BR no PR
  com cabeçalho e marca de IA; a raiz exige artefatos em inglês, proíbe
  comentários não solicitados e proíbe atribuição a IA.
- `code-reviewer.md` e `spec-author.md` referenciam `.docs/architecture.md`,
  `.docs/objective.md` e `.specs/_template.md`, ausentes na árvore.
- `AGENTS.md` + `scripts/agents-mirror-lib.mjs` espelham toda a árvore
  `.claude` em `.agents`; não há `.codex/config.toml` nem perfis nativos
  `.codex/agents`. Arquivos de settings/prompts copiados não equivalem a
  configuração nativa Codex.
- Skill `ship` opera checkout do usuário; falta contrato único para alvo de
  review, correções, propriedade de worktree, comandos pesados e continuação.
- Skills existentes (13) e 2 agentes Claude devem ser preservados; a
  validação atual (bytes iguais, exclusões, symlinks) não cobre configuração
  nativa, papéis, referências, integridade de vendor nem comportamento
  observado.

## Glossário

- Configuração nativa: arquivos no formato do cliente (`config.toml`, perfis
  de agente, hooks) descobertos pelo próprio cliente, distintos de skills
  compartilhadas e de prompts copiados.
- Papel: perfil nomeado (implementador, revisor, auditor) com modelo/esforço,
  permissões de ferramenta, sandbox e vedação de autopublicação/autoaprovação.
- Impeccable: skill/CLI de qualidade visual/auditoria, instalável por
  cliente a partir de revisão versionada e pinada, sem motor embutido no repo.
- Evidência observada: resultado lido da execução real (versão exibida,
  ferramenta descoberta, hook disparado); nunca inferido de configuração.

## Requisitos

### Ubíquo

- O sistema deverá expressar uma única regra de autorização: integração
  (`dev`) após review independente e CI verde; release (`main`) sempre com
  aprovação explícita do owner.
- O sistema deverá manter artefatos de repositório em inglês e comunicação
  com o owner em português, sem comentários não solicitados em PRs/issues
  e sem atribuição a IA.
- O sistema deverá manter skills compartilhadas em seus diretórios de
  descoberta documentados e separar configuração nativa por cliente, sem
  espelhamento indiscriminado de árvore inteira.
- O sistema deverá preservar instruções úteis com escopo, EARS, Makefile,
  posicionamento self-hosted e fronteira de release existentes.
- O sistema deverá centralizar parâmetros de modelo/esforço por papel sem
  copiar pins de outra organização nem trocar silenciosamente o modelo da
  sessão do orquestrador.
- O sistema deverá manter preferências locais, credenciais, autenticação
  MCP, settings nativos alheios e garantias do espelho (exclusões, symlinks,
  binários) existentes.

### Evento

- Quando um revisor concluir, deverá emitir `APROVADO`, `MUDANÇAS
  NECESSÁRIAS` ou `BLOQUEADO`, sem publicar, sem autoaprovar e sem converter
  evidência ausente em aprovação.
- Quando correções entrarem após um review, deverão invalidar a aprovação
  anterior e exigir novo review do alvo final exato (SHAs base/head).
- Quando o implementador for Codex, deverá usar o perfil selecionado pelo
  owner; quando for Claude Code, o seu; indisponibilidade de perfil deverá
  ser reportada sem substituição silenciosa.
- Quando a entrega for de autoria Claude, a revisão primária deverá passar
  pela CLI Codex com perfil de review; o fallback nomeado só vale quando a
  rota primária estiver indisponível, sem executar ou falhar na autenticação.
- Quando Impeccable emitir veredito visual, este não deverá satisfazer nem
  dispensar code/security review, CI ou autorização de deploy.
- Quando doctor/diagnóstico rodar, deverá separar declarado, efetivamente
  carregado e observado; capacidade ausente deverá ser estado explícito não
  verificado, nunca sucesso.
- Quando hook mapear ferramenta do cliente, deverá documentar cobertura e
  limites; hooks não substituem sandbox, permissões nem autorização da tarefa.

### Estado

- Enquanto skills existirem, cada uma deverá ter gatilho, fronteira,
  evidências exigidas e mapa de migração de legados sobrepostos.
- Enquanto papéis existirem, revisores deverão ser somente-leitura nos
  controles do cliente, revisar o alvo completo e reportar bloqueio.
- Enquanto worktrees existirem, preparação deverá usar worktree isolada de
  refs de integração verificadas, preservando checkout e traitement de
  lifecycle do usuário.
- Enquanto auditoria de segurança existir, candidatos deverão ser verificados
  por instância separada (confirmado/refutado/não verificado); cobertura
  parcial e inventário incompleto deverão permanecer visíveis.
- Enquanto Impeccable estiver instalado, `audit` geral e demais comandos
  existentes deverão permanecer intactos; registros duplicados, arquivos
  pessoais apagados e adaptações locais sobrescritas são proibidos.

### Opcional

- Onde depuração sistemática e verificação de conclusão agregarem valor sem
  invocar framework para pergunta simples, o sistema deverá adotar fluxos
  selecionados de fonte permissiva com payload pinado.

### Comportamento indesejado

- Se configuração copiada passar por integração nativa, o sistema deverá
  rejeitar a equivalência e exigir validação por cliente.
- Se motor/navegador/rede estiver indisponível, o sistema deverá permitir
  análise baseada em fonte e marcar checagem de engine/render como não
  verificada, nunca como sucesso.
- Se diagnóstico padrão exigir, não deverá emitir chamadas pagas a modelos,
  publicar dados, alterar confiança/autenticação nem despejar segredos,
  tokens, transcrições ou ambiente.
- Se instalação global, trust automático, bypass elevado ou importação
  integral de referência for proposta, o sistema deverá rejeitar.
- Se veredito adverso existir, trocar de revisor para evitá-lo é proibido;
  evidência ausente permanece bloqueio.

## Critérios de aceite

- [ ] Regras de autorização, idioma de artefato, comentários, autoria,
  vereditos e arquitetura resolvidos em uma política documentada, sem
  perder decisões de produto/workflow do Voxen.
- [ ] Perfis nativos gerados concordam em Codex `gpt-6.1-sol`/`high` e
  Claude `opus`/`medium`; indisponibilidade reportada, sem substituição.
- [ ] Matriz papel/rota e rota Claude→Codex explícitas; fallback testado
  para indisponibilidade real de execução, sem converter ausência em
  aprovação.
- [ ] Solicitado/efetivo/observado (modelo, esforço, hooks) reportados em
  separado; sem bypass, sem política nativa sem suporte.
- [ ] Fixtures de security-audit cobrem achado confirmado, candidato
  refutado, evidência ausente, inventário parcial e zero achados com áreas
  não verificadas.
- [ ] Habilidades descobertas por ambos os clientes em sessão limpa;
  settings nativos validados em separado da sincronização.
- [ ] Impeccable disponível nos dois clientes a partir de combinação
  pinada, atribuída e compatível; `audit` e configs alheias intactos.
- [ ] Reinstalação/atualização idempotente, com escopo, sem duplicar
  registros nem apagar arquivos pessoais ou adaptações.
- [ ] Revisores observavelmente somente-leitura, sem publicar nem
  autoaprovar, sobre o alvo exato, reportando bloqueio.
- [ ] Worktree/review/CI/continuação preservam checkout do usuário e
  vinculam validação ao snapshot final.
- [ ] Checagens de espelho/gerador preservam exclusões, symlinks, binários
  e arquivos nativos alheios, detectando drift real.
- [ ] Doctor separa declarado/carregado/observado; sem segredos na saída;
  indisponível nunca é sucesso.
- [ ] Hooks cobrem ações proibidas, comandos legítimos, cliente ausente e
  subdiretório/worktree, com limites por cliente.
- [ ] Setup/documentação a partir de clone limpo passam sem acesso a
  repositório privado ou infra interna.
- [ ] Ferramentas e artefatos transitórios não adicionam dependências de
  runtime, configuração de provider de modelo ou serviços à aplicação.

## Entrega

PRs focadas contra `dev` (review independente, CI verde, squash):

1. Política unificada + integração nativa (matriz papel/modelo, rota de
   review, separação skills vs nativo).
2. Impeccable pinado + workflows adotados (instalação por cliente,
   migração de legados).
3. Guards/doutor/CI (hooks, validação de schema, drift, referências).

Manter cada estado intermediário utilizável; não referenciar fluxos
removidos nem dispensar review porque um guard novo existe.

## Fora do escopo

Mudanças de aplicação, instalação em ambiente global do desenvolvedor,
distribuição corporativa automática, grants de trust, importação integral
de referência, refactors de produto, redesign de UI, billing, chat/history,
voice/STS e achados de outra aplicação como defeitos do Voxen.
