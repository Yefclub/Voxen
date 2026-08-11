# Spec 191 — Sinais pessoais de interesse

## Contexto

A Voxen já conhece o conteúdo que cada pessoa decidiu guardar, mas ainda não
distingue uma simples abertura de uma preferência declarada. Sem essa
separação, um Guia pessoal pode transformar curiosidade momentânea em gosto
permanente ou tratar uma inferência como decisão do usuário.

Esta spec materializa a segunda entrega já aprovada da evolução do Guia:
registrar eventos de interesse e oferecer feedback explícito, mantendo sinais
observados e declarações do usuário semanticamente distintos. As projeções de
curto, médio e longo prazo serão construídas sobre este histórico em entregas
posteriores.

## Glossário

- **Sinal observado**: interação registrada pelo sistema sem afirmar uma
  preferência, como abrir uma transcrição.
- **Preferência explícita**: declaração do usuário para receber mais ou menos
  conteúdo semelhante.
- **Limpeza de preferência**: declaração que remove o efeito da preferência
  explícita anterior sem apagar o histórico auditável.
- **Estado atual**: último feedback explícito válido para uma transcrição.

## Requisitos

### Ubiquitous

- The system shall vincular cada evento de interesse exclusivamente ao usuário autenticado e ao conteúdo pertencente a ele.
- The system shall distinguir sinais observados de preferências explícitas no contrato persistido e no contrato da API.
- The system shall preservar eventos como histórico imutável e derivar o estado explícito atual pelo evento válido mais recente.
- The system shall limitar metadados de eventos a contexto operacional estruturado, sem copiar o texto integral da transcrição, consultas ou mensagens do usuário.
- The system shall remover os eventos vinculados quando a transcrição for removida definitivamente.
- The system shall manter feedback pessoal fora da configuração global e das superfícies administrativas da instância.

### Event-driven

- When uma pessoa abrir o detalhe de uma transcrição ativa ou arquivada, the system shall registrar no máximo um sinal observado de visualização por usuário, transcrição e dia UTC.
- When uma pessoa escolher “mais como isto”, the system shall acrescentar uma preferência explícita positiva e refletir o novo estado na interface.
- When uma pessoa escolher “menos como isto”, the system shall acrescentar uma preferência explícita negativa e refletir o novo estado na interface.
- When uma pessoa limpar o feedback atual, the system shall acrescentar um evento explícito neutro e remover a seleção visual anterior.
- When o detalhe da transcrição for carregado, the system shall apresentar o estado explícito atual sem inferi-lo a partir de visualizações.

### State-driven

- While um feedback explícito estiver sendo persistido, the system shall impedir envios duplicados e manter o último estado confirmado visível.
- While o registro observado estiver indisponível, the system shall manter a leitura da transcrição funcional e não apresentar uma preferência falsa.
- While uma transcrição estiver arquivada, the system shall permitir visualização e feedback com o mesmo isolamento aplicado ao conteúdo ativo.

### Optional

- Where a pessoa já tiver selecionado a opção solicitada, the system shall tratar a nova seleção como limpeza explícita da preferência.

### Unwanted behavior

- If a transcrição não pertencer ao usuário autenticado, then the system shall responder como não encontrada sem revelar eventos ou preferências.
- If a transcrição estiver na lixeira, then the system shall recusar novos sinais e não retornar seu estado de interesse.
- If o tipo de feedback for desconhecido ou o corpo estiver malformado, then the system shall rejeitar a operação sem gravar eventos.
- If duas visualizações do mesmo usuário e transcrição ocorrerem no mesmo dia UTC, then the system shall manter somente um evento observado para aquele intervalo.
- If uma gravação explícita falhar, then the system shall restaurar o último estado confirmado e apresentar feedback não bloqueante.

## Critérios de Aceite

- [x] O schema persiste eventos pessoais com origem, tipo, sinal, data, vínculo ao usuário e exclusão em cascata com a transcrição.
- [x] A API autenticada registra visualizações de forma idempotente e retorna o feedback explícito atual.
- [x] A API alterna entre feedback positivo, negativo e limpo sem converter visualizações em preferência.
- [x] Transcrições de outro usuário e itens na lixeira não expõem nem aceitam sinais.
- [x] O detalhe da transcrição mostra controles acessíveis de “mais”, “menos” e limpeza em PT-BR e inglês.
- [x] A falha de telemetria observada nunca impede a leitura do conteúdo.
- [x] Testes cobrem isolamento, idempotência diária, alternância explícita, ordenação do estado e exclusão em cascata.
- [x] A interface é validada em desktop e smartphone, incluindo estados selecionado, carregando e erro.

## Fora de Escopo

- Calcular projeções de interesse de curto, médio ou longo prazo.
- Criar preferências por tópico, entidade, autor, canal, pasta ou tag.
- Alterar pesos, comunidades, centralidade ou ranking do grafo.
- Instrumentar buscas, citações do chat, ingestão, MCP ou compartilhamentos.
- Montar a página ou as recomendações do Guia pessoal.
- Expor análises pessoais a administradores.

## Riscos / Decisões pendentes

- Uma abertura diária é deliberadamente um sinal fraco; a próxima projeção
  decidirá seu peso e decaimento sem reclassificá-la como preferência.
- O histórico explícito permanece auditável mesmo após a limpeza; somente a
  remoção definitiva do conteúdo elimina os eventos associados.
