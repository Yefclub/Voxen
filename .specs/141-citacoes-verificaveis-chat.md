# Spec 141 — Citações verificáveis no chat

## Contexto

O agente já pode validar trechos de transcrições, mas o resultado não é uma
estrutura persistida e navegável pelo produto. O usuário não consegue auditar
uma afirmação com segurança após o stream terminar.

## Requisitos

### Ubiquitous

- The system shall persistir citações estruturadas da resposta com fonte, trecho literal, localização, URL navegável e estado de validação.
- The system shall renderizar evidência, inferência e ausência de evidência de forma distinguível.
- The system shall manter as mensagens históricas sem citação estruturada legíveis sem marcar evidência como verificada.

### Event-driven

- When a citação validada for persistida, the system shall disponibilizar um link que abre a fonte na localização correspondente.
- When uma citação não puder ser validada deterministicamente, the system shall marcá-la como não verificada e não como evidência.

### State-driven

- While uma fonte não pertencer ao usuário da conversa, the system shall não serializar nem renderizar a citação.

### Optional

- Where uma fonte possuir timestamp, the system shall incluir o intervalo temporal na navegação e no cartão.

### Unwanted behavior

- If uma citação possuir campos inválidos ou inconsistentes, then the system shall descartá-la com segurança sem impedir o carregamento da mensagem.

## Critérios de Aceite

- [ ] Respostas com evidência exibem cartões clicáveis e localização suficiente para auditoria.
- [ ] Citação inválida não recebe estado verificado.
- [ ] Navegação, serialização e isolamento por usuário possuem testes.
- [ ] Mensagens legadas degradam com segurança.

## Fora de Escopo

- Citações de pesquisa web e alteração do modelo de recuperação.

## Riscos / Decisões pendentes

- A citação só é verificável quando uma ferramenta determinística do workspace a produziu; texto livre do modelo não cria evidência verificada.
