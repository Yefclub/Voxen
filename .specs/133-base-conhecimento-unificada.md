# Spec 133 — Base de conhecimento unificada

## Contexto

O chat pode responder a perguntas sobre conteúdos existentes sem recuperar a fonte
curada pelo usuário. Transcrições e notas são pesquisadas por caminhos diferentes,
o que faz uma nota relevante não participar da sugestão inicial nem da resposta.
O MCP reproduz essa separação para clientes externos.

Esta feature consolida a Base de conhecimento como fonte canônica para o chat e
para o MCP, preservando as ferramentas especializadas existentes para compatibilidade.

## Glossário

- **Base de conhecimento**: conjunto de transcrições, documentos, páginas, uploads e
  notas manuais pertencentes ao workspace.
- **Fonte curada**: nota manual do usuário, que recebe preferência somente quando
  sua relevância textual é comparável à de outra fonte.
- **Proveniência**: vínculo explícito entre uma nota e uma ou mais fontes que a sustentam.

## Requisitos

### Ubiquitous (sempre verdadeiros)

- The system shall usar “Base de conhecimento” como termo canônico em textos em português e “Knowledge base” em textos em inglês.
- The system shall incluir notas e transcrições na recuperação de contexto para perguntas temáticas.
- The system shall identificar o tipo, título, trecho e origem de cada resultado recuperado.
- The system shall manter as ferramentas MCP especializadas existentes compatíveis para clientes já configurados.
- The system shall permitir que uma nota registre múltiplas fontes de proveniência, cada uma limitada ao workspace do proprietário.

### Event-driven (resposta a evento)

- When o usuário fizer uma pergunta factual ou temática no chat, the system shall pesquisar a Base de conhecimento antes de o modelo produzir uma resposta.
- When a busca unificada retornar uma nota e uma transcrição com relevância comparável, the system shall ordenar a nota curada antes da transcrição.
- When um cliente MCP pesquisar conteúdo temático, the system shall disponibilizar a mesma busca unificada usada pelo chat.
- When uma resposta usar uma nota recuperada, the system shall exibir uma citação navegável para essa nota.
- When uma nota for criada ou editada com fontes de proveniência, the system shall validar e persistir todos os vínculos informados.

### State-driven (durante um estado)

- While a pergunta possuir evidência suficiente na Base de conhecimento, the system shall não usar pesquisa web como fonte primária.
- While uma fonte de proveniência pertencer a outro workspace ou não existir, the system shall não criar nem manter o vínculo.

### Optional (feature opcional)

- Where o usuário solicitar informação atual que não esteja sustentada pela Base de conhecimento, the system shall poder complementar a resposta com fonte externa e distingui-la da evidência interna.

### Unwanted behavior (condições de erro)

- If a consulta não retornar evidência suficiente na Base de conhecimento, then the system shall informar essa ausência sem inventar fonte.
- If uma citação de nota não puder ser resolvida, then the system shall preservar a resposta sem apresentar um link inválido.

## Critérios de Aceite

- [ ] Nenhum texto de produto, prompt ou documentação ativa usa “acervo”; PT-BR usa a nomenclatura canônica e inglês usa a equivalente.
- [ ] Uma pergunta sobre “repo do Buzz” recebe a nota curada correspondente como resultado de recuperação inicial junto de resultados de transcrição, quando existirem.
- [ ] A busca unificada ordena resultados de notas e transcrições por relevância, com preferência controlada para notas curadas.
- [ ] O chat não depende de uma decisão do modelo para tornar notas visíveis na recuperação inicial.
- [ ] O MCP expõe busca unificada com o mesmo formato e resultado do domínio de recuperação do chat, mantendo as ferramentas antigas.
- [ ] Respostas que citam nota produzem link navegável para a nota correta.
- [ ] Uma nota pode manter múltiplos vínculos de proveniência e rejeita fontes inexistentes ou de outro workspace.
- [ ] Testes automatizados cobrem busca unificada, prioridade de nota, contrato MCP, i18n e o cenário Buzz.

## Fora de Escopo

- Alterar rotas legadas, nomes de tabelas ou chaves internas apenas para acompanhar a nomenclatura de produto.
- Usar embeddings ou RAG vetorial como requisito para a recuperação unificada.
- Migrar automaticamente vínculos de proveniência inferidos pelo Brain.

## Riscos / Decisões pendentes

- A prioridade de nota é limitada a resultados textualmente relevantes para não ocultar uma fonte primária mais precisa.
- Clientes MCP existentes continuam podendo consultar transcrições ou notas isoladamente; a nova busca é a recomendada nas instruções do servidor.
