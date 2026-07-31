# 126 — Chat: correções de interface e anexos

## Contexto

Uso real do chat expôs cinco problemas — dois funcionais e três de
interface. Todos vivem no mesmo território (`apps/web/src/client/pages/chat.tsx`,
componentes do composer e o runtime do agente), por isso entram na mesma
spec.

1. **Raciocínio não aparece.** Com o modelo atualmente configurado, o bloco
   de raciocínio (reasoning) não é exibido na interface, embora a
   infraestrutura de segments/`ThinkingBlock` exista e funcione com outros
   modelos. Precisa ser investigado onde o stream de reasoning se perde —
   pode ser formato do provedor (`reasoning` string vs.
   `reasoning_details` estruturado), pode ser o modelo não emitir por
   configuração, pode ser filtro no caminho de render.
2. **Ferramentas não compactam ao fim do turno.** Quando o agente chega à
   resposta final, o bloco de ferramentas continua expandido, ocupando a
   tela. O esperado é colapsar em um resumo compacto assim que o turno
   termina, mantendo o conteúdo acessível sob clique.
3. **Documento anexado não é atribuído à mensagem do usuário.** Ao enviar
   uma mensagem com documento anexado, o anexo não aparece vinculado
   àquela mensagem. Funcionalmente errado — o usuário perde o rastro do que
   enviou.
4. **PromptBox não cresce com o texto.** Com bastante texto, o composer não
   expande até um limite razoável, prejudicando a redação de mensagens
   longas.
5. **Ícone de enviar fora do padrão.** O ícone do botão de enviar destoa do
   conjunto de ícones usado no resto da aplicação.

## Requisitos

### Ubiquitous

- The system shall exibir o raciocínio do modelo na interface sempre que o
  provedor o emitir, independentemente do formato em que for transmitido.
- The system shall usar, no botão de enviar do chat, um ícone do mesmo
  conjunto visual empregado no restante da aplicação.

### Event-driven

- When o turno do assistente termina (resposta final concluída), the system
  shall apresentar o bloco de ferramentas em forma compacta, mantendo o
  detalhamento acessível por interação explícita do usuário.
- When o usuário envia uma mensagem com um ou mais documentos anexados, the
  system shall vincular esses anexos à mensagem enviada e exibi-los junto
  dela no histórico.
- When o conteúdo digitado no composer excede a altura mínima, the system
  shall expandir o composer progressivamente até um limite máximo definido,
  passando a rolar internamente a partir dele.

### Unwanted behavior

- If o modelo não emitir raciocínio em um turno, then the system shall
  simplesmente não exibir bloco de raciocínio — sem espaço vazio, sem
  indicador de carregamento preso.

## Critérios de Aceite

- [ ] Raciocínio do modelo configurado aparece na interface durante e após
      o turno.
- [ ] Ao fim do turno, o bloco de ferramentas aparece compactado; expandir
      continua disponível.
- [ ] Documento anexado aparece vinculado à mensagem do usuário no
      histórico, inclusive após recarregar a página.
- [ ] Composer cresce com o texto até um teto e depois rola internamente.
- [ ] Ícone de enviar vem do mesmo conjunto de ícones do restante do app.
- [ ] Testes cobrindo a lógica testável de cada item (parsing/normalização
      de reasoning, estado de colapso ao fim do turno, vínculo do anexo).

## Fora de Escopo

- Versionamento de mensagens (spec 127).
- Mudanças no comportamento de rolagem/anchoring do chat.
- Troca do modelo padrão ou de configuração de modelos (spec 123).

## Diagnóstico (investigação, 2026-07-31)

1. **Raciocínio.** Não é limitação do provedor. O modelo configurado em
   produção (`deepseek/deepseek-v4-flash-0731`, conforme
   `chat-provider-request-start` nos logs do app) **emite** raciocínio, o
   `@openrouter/ai-sdk-provider` converte tanto `reasoning_details` quanto
   `reasoning` em `reasoning-delta`, `runtime.ts` acumula e **persiste**:
   a coluna `ChatMessage.segments` em produção contém segmentos
   `{"type":"reasoning","text":"O usuário pergunta se temos conteúdo
   sobre…"}` completos. A perda é no render: a spec 119 (PR #484) trocou
   `{segment.text}` por um resumo operacional fixo
   (`chat.reasoningInProgress` / `chat.reasoningCompleted`), com o
   argumento de que "cadeia de raciocínio não é um artefato de produto".
   Esta spec **reverte essa decisão** para o raciocínio do modelo — que
   fica dentro do bloco recolhível, não é prompt nem instrução interna. O
   resumo operacional permanece como fallback quando o segmento não tem
   texto.
2. **Compactação.** O bloco já colapsava, mas só quando o stream fechava
   (`inFlight = live`), então ficava aberto durante toda a digitação da
   resposta final. Passa a sair de voo quando a resposta final começa.
3. **Anexo.** O composer nunca enviou nada junto da mensagem: `startUpload`
   chamava `uploadMedia` (job de ingestão) e o POST `/api/chat` levava
   apenas `{ content }`. Não havia campo em `ChatMessage` — daí a coluna
   `attachments` nova.
4. **Composer.** `rows={1}` + `max-h-40` sem medir `scrollHeight`: nunca
   crescia. O dock de transcrição já tinha o padrão correto.
5. **Ícone.** O catálogo `@animateicons/react/lucide` não tem seta simples
   (`ArrowUp` é apelido de `AArrowUpIcon`, o "A↑" de tamanho de fonte — foi
   esse desenho ambíguo que motivou a troca pelo avião de papel). Usa-se a
   família de chevrons, a mais empregada no restante da aplicação.

## Riscos / Decisões pendentes

- Exibir o raciocínio conflita com **duas** cláusulas vigentes, ambas
  anotadas como superseded neste ponto específico:
  - spec 119 § Ubiquitous ("apresentar no chat somente resumos operacionais
    sanitizados, nunca prompts, cadeia de raciocínio ou instruções internas
    do modelo") e o critério de aceite correspondente ("não renderiza
    raciocínio bruto persistido"), além da premissa em Riscos ("cadeia de
    raciocínio não é um artefato de produto");
  - spec 071 § Ubiquitous ("apresentar respostas Markdown, fontes e eventos
    de ferramentas sem expor segredos, **cadeia de raciocínio bruta** ou JSON
    técnico não seguro").

  Esta spec é posterior e explícita; o critério aqui é: raciocínio **do
  modelo** é exibível dentro do bloco recolhível, prompts, instruções
  internas, segredos e JSON técnico não seguro continuam fora. Os requisitos
  originais NÃO foram removidos das specs 119 e 071 — foram marcados, para que
  a próxima passada nessa superfície não os reverta por engano.
- O anexo vira `{jobId, name, kind}` em `ChatMessage.attachments`. O cliente
  envia apenas ids de job; nome e tipo são resolvidos no servidor com escopo
  `userId`, para que um id de outro workspace não vire anexo nem vaze nome
  de arquivo alheio.
- **Divergência deliberada do ícone de enviar entre os dois composers.** O
  composer principal (`pages/chat.tsx`) usa `ChevronUp`; o dock de chat do
  detalhe de transcrição (`components/library/transcript-chat-dock.tsx`)
  continua com o avião de papel. Não é omissão: o dock **já usa `ChevronUp`
  no próprio cabeçalho** como affordance de expandir/recolher (com
  `rotate-180`), então reaproveitar o mesmo glifo no botão de enviar
  colocaria dois desenhos idênticos com significados diferentes a poucos
  pixels um do outro. `page-presentation-contract.test.ts` passa a guardar os
  dois lados, para que a divergência siga intencional em vez de acidental.

  Trade-off registrado: `ChevronUp` é, no vocabulário geral de UI, affordance
  de expandir/recolher, e sua animação de hover desenha um segundo chevron
  fantasma subindo (efeito de rastro). O catálogo animado não oferece seta
  simples — `ArrowUp` é apelido de `AArrowUpIcon` ("A↑"). Se o owner preferir
  um glifo inequívoco de envio nos dois composers, o caminho é voltar ambos
  para `Send`, o que contraria o requisito 5 como escrito e precisa da
  decisão dele.
- **Teto do composer é relativo à viewport**: `min(200px, 30dvh)`. 200px fixos
  comiam quase toda a área útil de um celular com o teclado aberto (~300px).
  A medição em JS usa `visualViewport` e remede no `resize`, porque o teclado
  virtual muda a viewport sem mudar o texto.
- **Fronteira de workspace com teste de comportamento.** A resolução dos
  anexos vive em `lib/chat/attachment-resolver.ts` com a busca injetável, e
  não mais inline na rota. Motivo: o escopo por `userId` estava coberto apenas
  por um `toContain` no texto-fonte da rota — reescrever a query sem o filtro,
  preservando a string num comentário, passava na suíte inteira. Agora o teste
  executa a função com um finder que emula o Postgres e reprova tanto pelo
  vazamento quanto pelo `where` sem escopo.
- **`attachmentKind` (cliente) e `detectUploadKind` (servidor)** continuam
  sendo duas tabelas de extensão. Enquanto forem duplicadas, um teste de
  paridade sobre todo o catálogo de `CHAT_UPLOAD_ACCEPT` segura o par — se
  divergirem, o chip trocaria de ícone sozinho ao chegar o snapshot.
- **`segments` é JSONB sem schema** e o backend o entrega apenas *tipado*
  (`as StoredMessageSegment[]`). Como o render passou a chamar
  `segment.text.trim()`, um registro sem `text` lançaria `TypeError` sob o
  ErrorBoundary global. `parseMessageSegments` normaliza no funil do snapshot,
  mesmo cuidado que `tools` já recebia em `isValidToolEvent`.
- **Os chips de anexo só saem do composer depois do `response.ok`.** Limpar
  antes do POST perdia os anexos em 409 (turno ocupado), 429 (rate limit) ou
  queda de rede, sem forma de re-vincular um job existente.
