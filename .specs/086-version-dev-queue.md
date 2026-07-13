# Spec 086 — Fila confiável de versão e changelog em dev

## Contexto

O workflow de versão criava uma PR com o `GITHUB_TOKEN`. Por proteção anti-loop do
GitHub Actions, essa criação não disparava os workflows de `pull_request`; a PR
ficava sem required checks e não podia ser mergeada. Enquanto ela permanecia
aberta, merges posteriores apenas detectavam “já existe PR” e encerravam, deixando
a versão e todas as novas notas presas em `changelog/unreleased`.

## Requisitos

### Ubiquitous

- The system shall manter no máximo uma PR automática de versão aberta contra
  `dev`.
- The system shall exigir os sete required checks registrados no SHA atual antes
  de mergear um bump de versão.
- The system shall tratar rollup vazio ou pertencente a outro SHA como falha, nunca
  como CI verde.

### Event-driven

- When um merge em `dev` encontra uma PR automática de versão pendente, the system
  shall substituí-la por um snapshot novo que consuma todo o changelog ainda não
  publicado.
- When a PR automática for criada, the system shall disparar explicitamente o
  workflow de CI no head da branch.
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
- [ ] O workflow dispara CI explicitamente para a branch criada pelo bot.
- [ ] O merge só ocorre com os sete required checks verdes no head atual.
- [ ] Falha, timeout, rollup vazio ou head divergente mantêm a PR aberta.
- [ ] O próximo bump consome todas as entradas acumuladas em
      `changelog/unreleased`.

## Fora de Escopo

- Alterar a política de required checks ou a proteção da branch `dev`.
- Fazer deploy da aplicação; o deploy continua sendo uma etapa separada.

## Riscos / Decisões pendentes

- O workflow `CI` precisa manter o gatilho `workflow_dispatch`; a remoção futura
  desse gatilho deve ser acompanhada por outra credencial capaz de criar eventos
  de `pull_request`.
