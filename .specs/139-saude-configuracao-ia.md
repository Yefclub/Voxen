# Spec 139 — Saúde da configuração de IA

## Contexto

Administradores definem uma configuração global de IA, mas não dispõem de uma
visão operacional que antecipe modelos indisponíveis, custos e impactos antes
que uma funcionalidade falhe para os usuários.

## Glossário

- **capacidade ativa**: finalidade que possui modelo configurado, compatível e disponível no catálogo autorizado.
- **teste administrativo**: chamada mínima de validação que não cria transcrição, nota ou conteúdo permanente.

## Requisitos

### Ubiquitous

- The system shall apresentar ao administrador modelo efetivo, modalidade, disponibilidade, última utilização, última falha conhecida e métricas agregadas por finalidade.
- The system shall calcular custo e latência agregados a partir de eventos de custo e duração de jobs, sem expor dados de conteúdo de outro usuário.
- The system shall associar a visão administrativa à revisão global corrente quando houver revisão.

### Event-driven

- When um administrador abre o painel de saúde, the system shall validar os modelos efetivos no catálogo autorizado pela chave atual.
- When um administrador solicita um teste por finalidade, the system shall validar a finalidade sem persistir transcrição, nota ou conteúdo de usuário.
- When um administrador simula a escolha de um modelo, the system shall informar as capacidades que ficariam indisponíveis antes de qualquer alteração.

### State-driven

- While uma finalidade estiver sem chave, modelo, disponibilidade ou modalidade exigida, the system shall marcá-la como indisponível e apresentar orientação acionável apenas ao administrador.

### Optional

- Where embeddings estiverem desabilitados, the system shall apresentá-los como capacidade inativa sem reportar falha operacional.

### Unwanted behavior

- If um usuário comum consulta capacidades, then the system shall retornar somente rótulo e disponibilidade, sem modelos, custos, falhas, revisões ou segredos.
- If o catálogo ou teste remoto falhar, then the system shall preservar a configuração e retornar detalhe técnico somente ao administrador e aos logs.

## Critérios de Aceite

- [x] Admin vê as sete finalidades, modelo, modalidade, disponibilidade, métricas e revisão atual.
- [x] Usuário comum recebe apenas capacidades ativas.
- [x] Teste administrativo não cria conteúdo persistente.
- [x] Simulação aponta impactos de modelo incompatível antes de salvar.
- [x] Falhas operacionais são acionáveis sem expor segredos.
- [x] Testes cobrem autorização, disponibilidade, teste sem persistência, impacto e isolamento de métricas.

## Fora de Escopo

- Alterar automaticamente modelos ou chaves.
- Histórico de custos detalhado por usuário fora do painel administrativo já existente.

## Riscos / Decisões pendentes

- Nem todos os fluxos persistem tempo de resposta diretamente; quando não houver evento cronometrado nem job concluído, a interface deve declarar a ausência em vez de inventar um valor.
