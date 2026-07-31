# 128 — Conteúdo, fila e ingestão: correções de uso

## Contexto

Três problemas observados em uso real, todos no território de conteúdo e
fila (páginas de transcrições e de jobs):

1. **Transcrições em markdown não renderizam.** Normalmente o conteúdo de
   uma transcrição não aparece renderizado como markdown — cai como texto
   cru ou não renderiza. A página de detalhe já importa e usa o componente
   `Markdown` e faz `stripMarkdownFrontmatter`, então o defeito está em
   algum ponto entre o conteúdo armazenado e o que chega ao componente,
   ou na escolha entre os dois modos de exibição existentes (`Markdown`
   direto vs. `TranscriptViewer`).
2. **Campo de colar link com placeholder excessivo.** Na página de
   transcrições, a caixa onde o usuário cola o link tem um placeholder
   longo demais. Deve ser substituído por uma indicação curta e direta, e
   o campo em si deve ganhar mais destaque visual — é a ação principal
   daquela tela.
3. **Fila sem ação de reprocessar.** Quando um item da fila falha, não há
   como pedir reprocessamento pela interface; o usuário precisa reenviar o
   link manualmente. Falta um botão de reprocessar disponível nos itens em
   estado de erro.
4. **Marcadores da linha do tempo desalinhados.** No histórico de um job
   (página de detalhe), os marcadores circulares de cada etapa não estão
   alinhados com a linha vertical que os conecta.

## Requisitos

### Ubiquitous

- The system shall exibir o conteúdo de uma transcrição em markdown
  renderizado, não como texto cru.
- The system shall alinhar os marcadores de etapa da linha do tempo de um
  job com a linha que os conecta.

### Event-driven

- When um item da fila está em estado de erro, the system shall oferecer
  uma ação explícita de reprocessar aquele conteúdo.
- When o usuário aciona o reprocessamento de um item com erro, the system
  shall enfileirar novamente aquele conteúdo e refletir o novo estado na
  interface, sem exigir que o usuário recole o link.

### Unwanted behavior

- If o reprocessamento não puder ser enfileirado (conteúdo já em
  andamento, origem inválida, falha do servidor), then the system shall
  informar o motivo ao usuário e manter o item no estado anterior.

## Critérios de Aceite

- [x] Conteúdo de transcrição aparece renderizado como markdown.
- [x] Campo de colar link com indicação curta e com destaque visual
      coerente com sua importância na tela.
- [x] Itens da fila em erro oferecem ação de reprocessar, que reenfileira
      o conteúdo.
- [x] Reprocessamento com falha informa o motivo sem corromper o estado do
      item.
- [x] Marcadores da linha do tempo alinhados com a linha conectora.
- [x] Testes cobrindo o caminho de reprocessamento (sucesso e recusa) e a
      escolha de renderização do markdown.

## Fora de Escopo

- Mudanças no pipeline de transcrição do worker.
- Redesenho geral das páginas de transcrições ou fila.
- Reprocessamento automático (sem ação do usuário).

## Decisões da implementação

- **Renderização (1).** A causa era a condição de escolha entre os dois
  modos: só `WEB`, `VISION` e `DOCUMENT` iam para `<Markdown>`; posts do X
  (`X_SEARCH`), cujo corpo é prosa markdown gerada por modelo, caíam no
  `TranscriptViewer`, que só sabe ler linhas `[HH:MM:SS]` e colapsa o resto
  num parágrafo com `##`/`**` crus. A escolha passou para
  `client/lib/transcript-render.ts`, dirigida pelo conteúdo: prosa (origem
  web ou método sem timestamp) vai para markdown; corpo com segmentos
  marcados no tempo mantém a leitura por trechos clicáveis. Cobre também o
  fallback do backend (`# título` + `plainText`) quando o `.md` do S3 não
  abre.
- **Reprocessamento (3).** Reaproveita o `POST /api/jobs/:id/retry` que já
  existia — deriva o dono da sessão, recusa job de outro usuário com 404,
  aceita só status terminal e trata a corrida de deduplicação (P2002 →
  devolve o job ativo). Nenhum endpoint novo. Recusa vira aviso com o motivo
  do servidor e o item permanece no estado anterior.
- **Estrutura da linha da fila.** Para o botão não ficar aninhado dentro do
  `<a>` da linha (HTML inválido, teclado/leitor de tela quebrados), o link
  virou overlay `absolute inset-0` e o botão sobe com `z-10`.

## Riscos conhecidos

- Reprocessar job de upload reenfileira a mesma `sourceUrl` `upload://…` e
  depende do objeto ainda estar no S3 — comportamento herdado do endpoint de
  retry já usado na página de detalhe do job, não introduzido aqui.
