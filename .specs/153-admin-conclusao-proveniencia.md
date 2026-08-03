# Spec 153 — Administração de usuários, conclusão verificável e proveniência

## Contexto

O Voxen já separa os workspaces de conteúdo por usuário, enquanto a configuração
operacional da instância pertence aos administradores. Faltam controles seguros
para administrar contas existentes e o estado de um job é declarado concluído
antes de resumo, tags e índice do Brain terminarem. Além disso, o pipeline de
vídeo não preserva toda a proveniência que o extrator conhece, limitando as
relações no grafo.

## Glossário

- **Pronto**: conteúdo cuja transcrição e todos os enriquecimentos solicitados
  terminaram sem pendência.
- **Concluído com pendências**: transcrição disponível, mas uma etapa de
  enriquecimento terminou com erro recuperável ou ainda requer nova tentativa.
- **Proveniência**: URL enviada, URL canônica da fonte, autor e canal do
  conteúdo externo.

## Requisitos

### Ubiquitous (sempre verdadeiros)

- The system shall escopar todo dado de conteúdo, job, evento, metadado de
  proveniência e relação do Brain ao `userId` do dono.
- The system shall manter configurações operacionais da instância e seleção de
  modelos sob controle global de administradores, sem expô-las como preferências
  pessoais.
- The system shall preservar pelo menos um usuário ADMIN aprovado na instância.
- The system shall nunca retornar cookies, tokens, arquivos privados ou dados
  de workspace de um usuário em respostas administrativas de outra conta.
- The system shall registrar URL canônica, URL originalmente enviada quando
  diferente, canal e autor disponíveis no conteúdo e no nó correspondente do
  Brain.

### Event-driven (resposta a evento)

- When um administrador promove, rebaixa, bloqueia, desbloqueia ou exclui uma
  conta, the system shall validar a transição e revogar imediatamente as sessões
  da conta afetada quando ela perder acesso.
- When um administrador solicitar a exclusão e confirmar exatamente o e-mail
  da conta alvo, the system shall apagar definitivamente a conta, seus dados de
  workspace, credenciais pessoais e objetos armazenados associados.
- When uma nova mídia ou página for processada, the system shall publicar e
  persistir cada etapa de transcrição, resumo, tags, indexação e extração do
  Brain em ordem temporal.
- When todas as etapas obrigatórias terminarem com sucesso ou forem
  legitimamente ignoradas, the system shall marcar o job como pronto.
- When uma etapa de enriquecimento terminar com falha recuperável, the system
  shall marcar o job como concluído com pendências, informar a etapa e permitir
  nova tentativa sem repetir a transcrição.
- When o extrator fornecer autor, canal ou URL canônica, the system shall
  persistir esses valores e reindexar o conteúdo no Brain.

### State-driven (durante um estado)

- While um job estiver em processamento ou concluído com pendências, the system
  shall exibir a linha do tempo completa de etapas na fila e no detalhe do job.
- While uma conta estiver bloqueada, the system shall negar novas sessões e
  chamadas protegidas dessa conta.
- While o administrador tentar rebaixar ou excluir o último ADMIN aprovado,
  the system shall recusar a operação sem alterar dados.

### Optional (feature opcional)

- Where uma transcrição já existir antes desta mudança, the system shall
  reindexar sua proveniência disponível sem inventar autor, canal ou URL.

### Unwanted behavior (condições de erro)

- If a confirmação de exclusão não corresponder exatamente ao e-mail da conta,
  then the system shall rejeitar a exclusão sem remover dados.
- If o administrador tentar administrar a própria conta em uma transição que
  removeria seu último acesso administrativo, then the system shall rejeitar a
  operação.
- If a URL ou metadado de proveniência for inválido, then the system shall
  descartá-lo em vez de persistir ou renderizar link inseguro.

## Critérios de Aceite

- [ ] Admin lista, bloqueia, desbloqueia, promove e rebaixa usuários com guards
  contra perder o último administrador.
- [ ] Exclusão exige o e-mail exato, remove dados de banco e armazenamento do
  alvo, e não afeta outro workspace.
- [ ] Um job não aparece como pronto antes de finalizar resumo, tags e Brain.
- [ ] Falha recuperável de enriquecimento aparece como pendência com etapa e
  ação de repetir.
- [ ] Fila e detalhe mostram a linha do tempo integral, inclusive após a
  transcrição existir.
- [ ] Vídeos persistem autor, canal, URL canônica e URL enviada quando o
  extrator as disponibiliza.
- [ ] O Brain usa autor, canal e domínio/URL como proveniência e sinais de
  relação, mantendo o escopo do dono.
- [ ] Testes cobrem permissão, último admin, exclusão confirmada, isolamento,
  estados de job e proveniência.

## Fora de Escopo

- Compartilhamento de conteúdos entre workspaces.
- Recuperar automaticamente metadados ausentes de fontes legadas pela rede.
- Cobrança, quotas comerciais ou multi-tenancy SaaS.

## Riscos / Decisões pendentes

- A exclusão de objetos S3 é irreversível; a confirmação textual reduz remoções
  acidentais.
- Falhas transitórias de IA não devem apagar a transcrição já extraída; por isso
  usam o estado explícito de pendência, não `FAILED`.

> 2026-08-03: aprovada pelo owner com exclusão definitiva confirmada por e-mail
> e estado separado de pendências para enriquecimentos.
