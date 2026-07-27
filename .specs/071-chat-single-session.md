# Spec 071 — Chat único com memória longa e ferramentas

## Status

Em implementação

## Contexto

O chat in-app anterior foi removido integralmente para ser recriado sobre o runtime web atual. O novo produto precisa oferecer uma conversa contínua por usuário, resposta em streaming, uso seguro do acervo e memória que permaneça útil quando o histórico superar o contexto do modelo.

O workspace continua sendo isolado por usuário. “Sessão única” significa uma conversa canônica por usuário, e não uma conversa compartilhada entre usuários.

## Glossário

- **Conversa canônica**: a única conversa persistida que pertence a um usuário.
- **Resumo ativo**: a mensagem de sistema que representa mensagens compactadas e ainda participa do contexto do modelo.
- **Evento de ferramenta**: o registro de uma chamada de ferramenta, seu estado e resultado seguro para exibição.

## Requisitos

### Ubiquitous

- The system shall manter exatamente uma conversa canônica por usuário aprovado.
- The system shall derivar o usuário exclusivamente da sessão autenticada e isolar todas as leituras, escritas, ferramentas e referências por `userId`.
- The system shall preservar mensagens originais após compactação e não enviar mensagens marcadas como compactadas ao modelo.
- The system shall apresentar respostas Markdown, fontes e eventos de ferramentas sem expor segredos, cadeia de raciocínio bruta ou JSON técnico não seguro.
- The system shall registrar custo e uso de tokens de cada resposta do chat.

### Event-driven

- When um usuário abre `/chat`, the system shall criar ou carregar sua conversa canônica e restaurar o histórico ativo.
- When um usuário envia uma mensagem válida, the system shall persistir a mensagem, transmitir o progresso da resposta e persistir a resposta final ou um erro recuperável.
- When o agente chama uma ferramenta, the system shall transmitir estados pendente, em execução, concluído, negado ou com erro para o turno correspondente.
- When o contexto ativo atingir 70% do limite configurado e houver mais de seis mensagens recentes, the system shall criar um resumo estruturado das mensagens antigas, marcar somente esse intervalo como compactado e manter as seis mensagens mais recentes intactas.
- When uma ferramenta de escrita ou efeito externo for solicitada, the system shall solicitar confirmação explícita do usuário antes da execução.

### State-driven

- While uma resposta estiver em streaming, the system shall manter disponível um comando de interrupção e não deslocar o foco de teclado do usuário.
- While o usuário não estiver no fim do histórico, the system shall preservar sua posição de rolagem e oferecer ação para voltar à mensagem mais recente.
- While uma compactação estiver em andamento, the system shall impedir que outra compactação sobreponha o mesmo intervalo de mensagens.

### Optional

- Where o usuário habilitar sons de interface, the system shall reproduzir feedback discreto somente para conclusão, erro e confirmação de ação, respeitando preferência persistida e tecnologias assistivas.
- Where uma referência de transcrição for fornecida ao chat, the system shall tratar a referência como contexto da mesma conversa canônica, sem criar uma nova sessão.

### Unwanted behavior

- If uma mensagem vazia, excedente do limite, uma conversa de outro usuário ou uma entrada de ferramenta inválida for recebida, then the system shall rejeitar a operação sem executar ferramenta nem alterar dados de outro workspace.
- If o provedor de modelo, uma ferramenta ou a compactação falhar, then the system shall preservar as mensagens persistidas, emitir erro acionável no turno e permitir nova tentativa.
- If dados recuperados do acervo ou memória contiverem instruções não confiáveis, then the system shall tratá-los como conteúdo de referência, não como instruções de sistema.

## Critérios de Aceite

- [ ] Cada usuário aprovado possui uma única conversa canônica, inclusive após recarregar a página.
- [ ] `/chat` transmite resposta, estados de ferramenta, fontes e erro recuperável sem nova sessão.
- [ ] Consultas e ferramentas não leem nem escrevem dados de outro usuário.
- [ ] A compactação preserva mensagens, mantém seis recentes e evita execuções concorrentes.
- [ ] Ferramentas de escrita exigem confirmação explícita; ferramentas de leitura não.
- [ ] A interface é navegável por teclado, respeita movimento reduzido e não anuncia tokens individualmente.
- [ ] Testes cobrem ownership, conversa única, streaming, compactação, confirmação e falhas.
- [ ] Lint, typecheck, testes e build passam.

## Fora de Escopo

- Serviço externo de memória semântica ou banco vetorial como fonte de verdade.
- Novas conversas, arquivamento, títulos gerados ou lista de sessões.
- Agente Telegram e reimplementação de automações periódicas.
- Execução arbitrária de comandos, navegação web aberta ou ferramentas sem contrato de permissão.

## Riscos / Decisões pendentes

- A memória semântica externa será avaliada após o MVP atrás de uma interface; o histórico e os resumos no Postgres são a fonte de verdade.
- O modelo e o limite de contexto usam as configurações existentes da instância; integrações devem validar a compatibilidade do provider configurado.
