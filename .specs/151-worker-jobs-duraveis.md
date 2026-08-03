# Spec 151 — Jobs duráveis com lease no worker

Issue: #576

## Problema

`Job` é persistido no Postgres, mas um worker que morre depois do claim deixa o
registro em `RUNNING` indefinidamente. Redis Pub/Sub é apenas um aviso efêmero e
o reconciliador atual busca somente `QUEUED`. Além disso, tarefas criadas pelo
subscriber não são supervisionadas durante o shutdown.

## Requisitos funcionais

- QUANDO um worker fizer claim de um job `QUEUED`, O SISTEMA DEVE registrar
  `workerId`, incrementar `attempt`, gravar `heartbeatAt` e `leaseExpiresAt` na
  mesma transação do claim.
- ENQUANTO o pipeline estiver em execução, O SISTEMA DEVE renovar o lease antes
  de seu vencimento e interromper o executor local se perder a posse.
- QUANDO um `RUNNING` possuir lease vencido, O RECONCILIADOR DEVE, de forma
  atômica e segura para múltiplos workers, recolocá-lo em `QUEUED` se ainda
  houver tentativas, ou encerrá-lo como `FAILED` com erro recuperável se o
  limite tiver sido atingido.
- QUANDO Redis perder o evento `jobs:new`, O RECONCILIADOR DEVE continuar
  encontrando o registro `QUEUED` pelo Postgres.
- QUANDO o processo receber SIGTERM/SIGINT, O WORKER DEVE parar de aceitar
  novos jobs, aguardar um período limitado pelos jobs em voo e devolver ao
  Postgres os jobs cancelados pelo shutdown.
- SE um job retomado já possuir `transcriptId`, O WORKER NÃO DEVE criar outra
  transcrição; deve concluir o checkpoint canônico existente.
- QUANDO o conteúdo canônico for persistido e vinculado ao job, O SISTEMA DEVE
  poder encerrar o job em 100% sem depender de resumo, tags, embeddings ou
  compilação do grafo.
- O POSTGRES DEVE ser a fonte durável da fila. Redis DEVE permanecer somente
  como wakeup e transporte realtime.
- Escritas canônicas de refresh DEVEM validar o lease na mesma transação da
  alteração do `Transcript`.
- Reconciliação e resumo DEVEM possuir cadências independentes; chamadas de IA
  não podem bloquear o reaper de jobs.
- Claims de resumo DEVEM ser cercados por sua geração (`summaryAttempts`) para
  impedir que uma execução antiga sobrescreva uma mais nova.

## Modelo de dados

Adicionar a `Job`:

- `workerId String?`
- `attempt Int @default(0)`
- `heartbeatAt DateTime?`
- `leaseExpiresAt DateTime?`

Criar índice por `status, leaseExpiresAt` para o reaper.

## Política operacional

- Lease: 90 segundos.
- Heartbeat: 20 segundos.
- Máximo: 3 tentativas.
- Checkpoint canônico: no máximo 1 tentativa adicional e barata para concluir
  `DONE`; falhas posteriores encerram o job.
- Reconciliação: no boot e no ciclo periódico existente.
- Falha final pública: informar que o processamento foi interrompido e pode ser
  reenviado, sem expor diagnóstico interno.

## Critérios de aceite

- Teste de notify perdido confirma processamento via reconciliação de `QUEUED`.
- Testes de lease confirmam claim exclusivo, renovação condicionada à posse e
  ausência de finalização por worker antigo.
- Testes de reaper confirmam requeue antes do limite e `FAILED` no limite.
- Teste de restart confirma retomada de job com transcrição já vinculada sem
  executar novamente o pipeline de ingestão.
- Teste de shutdown confirma rastreamento e cancelamento/requeue das tarefas.
- Teste de indisponibilidade do Redis confirma persistência de progresso e
  processamento de `QUEUED` exclusivamente via Postgres; um `CANCELLED`
  persistido também interrompe o executor sem depender do canal Redis.
- Testes de fencing confirmam que refresh e resumo antigos não sobrescrevem a
  geração atual.
- Migration SQL pode ser reaplicada apó execução parcial sem encurtar leases
  ativos que já possuem dono.
- Documentação não afirma mais que ARQ é a implementação atual.

## Fora de escopo

- Trocar Postgres por um broker de fila externo.
- Garantia exactly-once para efeitos externos; o contrato é at-least-once com
  checkpoints idempotentes e fencing por lease.
- Alterar a experiência visual da Fila além dos estados já existentes.
