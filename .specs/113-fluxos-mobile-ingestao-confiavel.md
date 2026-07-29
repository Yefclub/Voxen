# 113 — Fluxos mobile, ingestão e superfícies de conteúdo confiáveis

## Contexto

O Voxen trata `/` e `/chat` como a mesma experiência de conversa, mas o drawer
mobile ainda mostra ambos os destinos. O gesto de abertura exige a borda
esquerda e a apresentação do drawer faz trabalho visual desnecessário durante a
interação. A biblioteca de notas, o aviso de nova versão e a página de
novidades também não aproveitam bem o espaço disponível.

O detalhe de jobs tem um canal SSE, porém os eventos não sobrevivem à conexão:
um usuário que abre a tela após o início do processamento recebe apenas o
estado terminal ou nenhum estágio atual. Além disso, os nomes dos estágios são
globais e podem descrever uma página como se fosse vídeo. No chat, a política
de URL concorre com a de pesquisa web e não define o que ocorre quando o link
não vem acompanhado de uma intenção clara.

## Glossário

- **Drawer mobile**: navegação lateral apresentada abaixo de `md`.
- **Evento operacional**: estágio, percentual e horário emitidos durante o
  processamento de um job.
- **Snapshot operacional**: estado e eventos persistidos de um job enviados ao
  abrir ou reconectar o stream.
- **URL ambígua**: mensagem com URL que não expressa uma ação compreensível
  sobre seu conteúdo.

## Requisitos

### Ubiquitous

- The system shall tratar `/` e `/chat` como a mesma experiência de chat na
  navegação mobile e não exibir o destino redundante `Início` no drawer mobile.
- The system shall preservar rolagem vertical, zoom do navegador e controles
  interativos durante a detecção do gesto de abrir o drawer.
- The system shall usar rótulos de estágio compatíveis com o tipo real do job,
  sem chamar uma extração web, documento, imagem ou post do X de transcrição de
  vídeo.
- The system shall manter eventos operacionais isolados por job e por usuário.
- The system shall não usar pesquisa web para substituir a ingestão de uma URL
  compartilhada pelo usuário.
- The system shall manter o diálogo de atualização acessível, com foco,
  fechamento visível e Escape suportados pelo componente de diálogo existente.

### Event-driven

- When um toque único começar em superfície não interativa da região central e
  avançar predominantemente para a direita além do limiar, the system shall
  abrir o drawer mobile; o gesto de borda existente continuará disponível.
- When o drawer abrir ou fechar, the system shall animar apenas propriedades de
  composição e respeitar `prefers-reduced-motion`, sem re-render por movimento.
- When um worker publicar um evento de job, the system shall persistir o evento
  e publicar sua atualização em tempo real.
- When a tela de um job conectar ou reconectar, the system shall receber um
  snapshot com tipo, estágio atual, percentual e eventos já persistidos antes
  de acompanhar novos eventos.
- When nenhuma nota estiver selecionada em `/notas`, the system shall mostrar a
  biblioteca navegável de notas e pastas, com ação para criar conteúdo.
- When o usuário abrir o aviso de versão, the system shall apresentar o resumo
  da release em área responsiva e oferecer acesso à página completa de
  novidades.
- When a mensagem do chat trouxer URL e intenção explícita de analisar,
  resumir, extrair ou transcrever, the system shall ingerir a URL antes de
  responder sobre seu conteúdo.
- When a mensagem do chat trouxer URL sem intenção clara, the system shall
  solicitar esclarecimento objetivo sem executar pesquisa web nem ingestão.

### State-driven

- While o drawer estiver fechado, the system shall não montar seu conteúdo
  pesado nem bloquear o scroll do documento.
- While o job estiver ativo, the system shall mostrar etapa atual, fonte/tipo,
  percentual, conexão e linha do tempo operacional atualizada.
- While a conexão SSE estiver indisponível para um job ativo, the system shall
  reconciliar o snapshot por polling limitado até a reconexão ou estado terminal.
- While uma resposta do chat estiver em streaming, the system shall manter a
  atualização bloqueada e explicar o motivo.

### Unwanted behavior

- If o gesto for vertical, multitoque, começar em controle interativo ou não
  atingir o limiar horizontal, then the system shall não abrir nem bloquear a
  interação normal.
- If eventos forem recebidos repetidamente por snapshot, polling ou SSE, then
  the system shall deduplicá-los por identidade estável sem reiniciar a linha do
  tempo.
- If uma URL não puder ser ingerida, then the system shall informar a falha sem
  trocar automaticamente para pesquisa web.

## Critérios de aceite

- [ ] Drawer mobile não mostra `Início`, mantém `Chat` e abre por borda ou
      arraste central para a direita sem capturar scroll, zoom ou controles.
- [ ] Lógica pura de gesto cobre direção, limiar, região central e elementos
      interativos; nenhum movimento gera atualização de estado React.
- [ ] Cada evento de job contém identidade, tipo, estágio, percentual e horário
      persistidos; o endpoint de eventos fornece snapshot antes de novos eventos.
- [ ] A timeline mostra estágios adequados para web, vídeo, upload, documento,
      imagem e X e permanece coerente após reconexão.
- [ ] `/notas` sem nota selecionada mostra a biblioteca reutilizando a árvore
      navegável e oferece criação.
- [ ] Modal de atualização e `/novidades` usam espaço responsivo e mantêm os
      contratos de acessibilidade e streaming.
- [ ] Casos de URL explícita, URL ambígua e URL inválida são cobertos por testes
      de política sem depender de strings do prompt como única proteção.
- [ ] `bun test`, `bun run lint`, `bun run typecheck`, `bun run format:check`
      e `bun run build` passam sem Docker ou Playwright.
- [ ] `node scripts/release-notes.mjs check` passa com changelog desta entrega.

## Fora de escopo

- Cache offline de jobs ou uploads em fila persistente.
- Expor raciocínio bruto do modelo ou prompts internos.
- Redesenhar a navegação desktop.
- Executar Docker ou Playwright nesta entrega.

## Riscos e decisões

- Eventos persistidos exigem migração Prisma e retenção limitada; a estrutura
  deve evitar crescimento sem limite e nunca expor eventos de outro usuário.
- O gesto central disputa com conteúdo horizontal; a política deliberadamente
  ignora elementos interativos e movimentos não predominantemente horizontais.
- A intenção da URL combina classificação determinística de mensagem e regras
  de ferramentas para não depender apenas da obediência do modelo ao prompt.
