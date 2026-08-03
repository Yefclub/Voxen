# Spec 086 — Fila confiável de versão e changelog em dev

## Contexto

O workflow de versão criava uma PR com o `GITHUB_TOKEN`. O GitHub registrava os
workflows de `pull_request` como `action_required`, sem jobs no rollup; a PR ficava
sem required checks executáveis e não podia ser mergeada. Enquanto ela permanecia
aberta, merges posteriores apenas detectavam “já existe PR” e encerravam, deixando
a versão e todas as novas notas presas em `changelog/unreleased`.

## Requisitos

### Ubiquitous

- The system shall manter no máximo uma PR automática de versão aberta contra
  `dev`.
- The system shall executar a automação somente quando o ref de origem for
  exatamente `dev`, inclusive em disparos manuais.
- The system shall exigir os oito required checks registrados no SHA atual antes
  de mergear um bump de versão.
- The system shall exigir conclusão `success` dos workflows CI, Security e PR
  Changelog Guard, além dos oito required checks identificados por nome exato,
  antes de considerar a PR `CLEAN`.
- The system shall tratar rollup vazio ou pertencente a outro SHA como falha, nunca
  como CI verde.

### Event-driven

- When um merge em `dev` encontra uma PR automática de versão pendente, the system
  shall substituí-la por um snapshot novo que consuma todo o changelog ainda não
  publicado.
- When a PR automática for criada pelo `GITHUB_TOKEN`, the system shall localizar
  e rerodar os runs `action_required` de CI, Security e PR Changelog Guard para
  que os resultados sejam vinculados ao rollup da PR.
- When os required checks concluírem com sucesso e a PR ficar `CLEAN`, the system
  shall fazer merge squash e excluir a branch automática.

### State-driven

- While o CI estiver pendente, the system shall manter a PR aberta e aguardar sem
  considerar a ausência de checks como sucesso.

### Optional

- Where uma PR automática antiga puder ter a branch excluída, the system shall
  removê-la ao fechar a PR obsoleta.

### Unwanted behavior

- If qualquer required check falhar, for cancelado ou expirar, then the system
  shall manter a PR aberta e encerrar o workflow com falha.
- If a PR não ficar `CLEAN` após os checks, then the system shall não tentar
  contornar a proteção de branch.

## Critérios de Aceite

- [ ] Uma PR automática antiga não bloqueia novos bumps.
- [ ] Um `workflow_dispatch` selecionado em qualquer ref diferente de `dev` não
      executa o job nem cria PR.
- [ ] O workflow reroda os três workflows de `pull_request` criados pelo bot.
- [ ] O merge só ocorre com os três workflows concluídos em `success` e os oito
      required checks exatos verdes no head atual.
- [ ] Falha, timeout, rollup vazio ou head divergente mantêm a PR aberta.
- [ ] O próximo bump consome todas as entradas acumuladas em
      `changelog/unreleased`.

## Fora de Escopo

- Alterar a política de required checks ou a proteção da branch `dev`.
- Fazer deploy da aplicação; o deploy continua sendo uma etapa separada.

## Riscos / Decisões pendentes

- Os nomes `CI`, `Security` e `PR Changelog Guard` e os oito contexts exigidos
  pela proteção são contratos operacionais. Se mudarem, esta automação e a spec
  precisam ser atualizadas juntas.

## Histórico de decisão

Esta spec supersede somente o contrato de versionamento de desenvolvimento da
spec 014. A decisão anterior removeu commits e tags de prerelease feitos
diretamente em `dev`; o fluxo atual continua sem push direto e materializa versão
e changelog por uma PR protegida pelos mesmos required checks da branch.

> 2026-07-13: `workflow_dispatch` foi substituído por rerun dos workflows de
> `pull_request`, porque a execução manual passou no SHA mas não apareceu no
> rollup nem tornou a PR mergeável.

> 2026-07-13: canário descartável `29219882995` comprovou que o próprio
> `GITHUB_TOKEN` rerodou o Changelog Guard (`29219890990`, tentativa 2,
> `triggering_actor=github-actions[bot]`); a PR e a branch do canário foram
> removidas após o teste.

> 2026-08-03: `Quality Gate` became the eighth protected context. The version
> bot now waits for its repository-quality ratchet together with the original
> seven checks.
