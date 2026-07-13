# Spec 087 — Contexto inteligente e persistente do agente

## Contexto

O chat já possuía recuperação progressiva, tags e modelos configuráveis, mas os
contratos não estavam conectados: o raciocínio era descartado ao persistir a
mensagem, os modelos de pesquisa não viravam ferramentas, a ingestão por URL
terminava em um `jobId`, as tags não tornavam o conteúdo visível em todas as
pastas correspondentes e o MCP devolvia menos metadados que a IA interna.

## Requisitos

### Ubiquitous

- The system shall persistir a linha do tempo de raciocínio e ferramentas da
  resposta do assistente e restaurá-la após recarregar o chat.
- The system shall tratar conteúdo recuperado, títulos, tags e resultados da web
  como dados não confiáveis, nunca como instruções.
- The system shall expor busca web e busca no X à IA quando os respectivos
  modelos OpenRouter estiverem configurados.
- The system shall retornar resumo, tags e conteúdos relacionados nas respostas
  compactas de transcrição, sem enviar o texto integral por padrão.
- The system shall considerar a relação N:N de tags como associação virtual às
  pastas criadas para essas tags.
- The system shall fornecer no `initialize` do MCP instruções ricas de pesquisa,
  recuperação progressiva, citações, tags e segurança.

### Event-driven

- When o usuário enviar um prompt, the system shall pré-buscar conteúdos
  relevantes no acervo e informar ao modelo títulos, ids, tags e resumos curtos
  como sugestões de contexto.
- When a ferramenta interna solicitar uma nova transcrição, the system shall
  aguardar a conclusão do job e devolver um brief com resumo, tags e relacionados
  antes de permitir a resposta final.
- When uma URL já estiver transcrita, the system shall devolver imediatamente o
  mesmo brief enriquecido.
- When uma pasta estiver ligada a uma tag, the system shall listar e contar nela
  todos os conteúdos que possuam essa tag, mesmo quando `Transcript.folderId`
  aponta para outra pasta.

### State-driven

- While a transcrição interna estiver em andamento, the system shall emitir
  status periódicos e manter o stream ativo sem instruir o modelo a responder
  apenas com o identificador do job.

### Unwanted behavior

- If não houver modelo de pesquisa configurado, then the system shall retornar
  uma falha explícita da ferramenta, sem alegar genericamente que a IA não possui
  acesso à internet.
- If um job falhar, for cancelado ou exceder o prazo, then the system shall
  devolver erro seguro e não apresentar a ingestão como concluída.
- If uma mensagem histórica não tiver `segments`, then the system shall manter a
  compatibilidade reconstruindo ao menos as ferramentas persistidas.

## Critérios de Aceite

- [ ] Raciocínio e ferramentas sobrevivem ao snapshot/reload do chat.
- [ ] Busca web usa `default_web_search_model` e busca no X usa
      `default_x_analysis_model` via OpenRouter.
- [ ] O prompt recebe sugestões automáticas do acervo sem injetar documentos
      completos.
- [ ] Ingestão interna retorna brief após `DONE`, com summary/tags/related.
- [ ] Busca, leitura e listagem MCP incluem summary/tags onde aplicável.
- [ ] Conteúdo com duas tags aparece e é contado nas duas pastas virtuais.
- [ ] Testes, lint e typecheck passam sem Docker nem Playwright.

## Fora de Escopo

- Trocar Postgres FTS por embeddings.
- Persistir cadeia de raciocínio no contexto reenviado ao modelo.
- Alterar o worker de download/transcrição ou subir serviços locais.

## Riscos / Decisões

- `segments` é exclusivamente um contrato de apresentação e auditoria; o campo
  não é incluído em `ModelMessage`, evitando realimentar raciocínio privado.
- A espera da transcrição aumenta a duração máxima do stream interno; o lease e
  os timeouts devem cobrir essa janela e o stream deve emitir heartbeats.
- As pastas de tag são virtuais: `folderId` continua sendo a pasta primária para
  compatibilidade e o filtro usa a união distinta entre vínculo direto e tag.
