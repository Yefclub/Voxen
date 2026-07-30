# Spec 119 — Regressões de interface e conteúdo em produção

## Status

Aprovada em 2026-07-30 a partir da auditoria autenticada solicitada pelo owner.

## Contexto

Uma revisão interativa da aplicação publicada confirmou que entregas anteriores
de consistência visual e estabilidade continuam incompletas. Páginas
operacionais equivalentes usam larguras diferentes, transições de rota exibem
quadros vazios, o editor de notas perde ações no mobile e o drawer pode manter
estado semântico e visual divergente.

O Grafo ainda produz rótulo ilegível no hover escuro, o histórico do chat
recalcula incorretamente a duração do raciocínio e expõe texto interno bruto, e
detalhes de processamento possuem hierarquia e navegação incorretas. Tags novas
são geradas, mas resultados históricos evidenciam duplicação e vazamento de
instruções do formato esperado.

Esta spec fecha essas regressões sem adicionar provedores, executar operações
destrutivas ou ampliar o domínio funcional da Voxen.

## Glossário

- **Shell operacional**: largura, gutters, cabeçalho e ritmo usados por páginas
  de biblioteca, administração, configuração e edição.
- **Resumo operacional**: descrição sanitizada de uma etapa da IA, sem prompt,
  cadeia de raciocínio ou instruções internas.
- **Estado visual fechado**: drawer sem transformação residual, sombra,
  backdrop, foco contido ou bloqueio do conteúdo.
- **Tag válida**: rótulo curto, útil ao domínio do conteúdo, único e livre de
  instruções de formato ou metalinguagem do modelo.

## Requisitos

### Ubiquitous (sempre verdadeiros)

- The system shall manter rótulos de nós legíveis nos temas escuros em estado
  normal, hover e seleção.
- The system shall manter ações do editor de notas visíveis e operáveis em
  viewports a partir de 320 pixels CSS.
- The system shall apresentar no chat somente resumos operacionais sanitizados,
  nunca prompts, cadeia de raciocínio ou instruções internas do modelo.
- The system shall preservar a duração concluída de uma resposta entre
  navegações, reloads e reconciliações.
- The system shall tratar `/` e `/chat` como aliases equivalentes em navegação,
  botão mobile e shell.
- The system shall manter o texto, destino e nível semântico dos controles de
  navegação coerentes com a página exibida.
- The system shall usar um shell operacional amplo e consistente nas páginas
  equivalentes, reservando largura de leitura apenas ao conteúdo interno que
  exige linha curta.
- The system shall manter tabelas do chat legíveis no desktop e roláveis no
  mobile sem competir com o drawer.
- The system shall armazenar e exibir somente tags válidas, normalizadas e sem
  duplicatas.
- The system shall manter histórico, estados operacionais e composer do chat na
  mesma coluna de largura, sem redesenhar a experiência conversacional.
- The system shall iniciar toda página com título e descrição por um eyebrow
  textual acompanhado de ícone colorido e animado, respeitando movimento
  reduzido.
- The system shall alinhar o início do conteúdo ao espaço já reservado pelo
  cabeçalho flutuante, sem adicionar uma segunda margem vertical.

### Event-driven (resposta a evento)

- When o ponteiro entrar em um nó do Grafo, the system shall destacar o nó e
  suas conexões sem criar faixa clara, sobreposição de rótulos ou perda de
  contraste.
- When o usuário selecionar um nó, the system shall abrir o inspetor com título
  e resumo formatados sem marcadores Markdown crus.
- When uma resposta terminar, the system shall congelar sua duração usando
  timestamps canônicos do turno e recolher a timeline operacional.
- When uma mensagem histórica for reidratada, the system shall reutilizar a
  duração persistida ou derivada dos eventos concluídos, sem usar o horário
  atual como término.
- When o drawer mobile abrir ou fechar, the system shall manter estado
  semântico, foco, transformação, backdrop e sombra sincronizados durante toda
  a transição.
- When uma nota for aberta no mobile, the system shall reorganizar título,
  status e ações sem corte ou overflow horizontal.
- When uma rota lazy ainda estiver carregando, the system shall preservar o
  shell da página e apresentar feedback local sem apagar a superfície inteira.
- When uma tag for recebida da IA, the system shall normalizar, validar,
  deduplicar e descartar metalinguagem antes de persistir.
- When o modal de nova versão abrir, the system shall preservar foco acessível
  sem desenhar uma moldura colorida ao redor de toda a região rolável.
- When o composer estiver pronto para enviar, the system shall exibir um ícone
  de envio inequívoco, sem letras ou glifos sem relação com a ação.

### State-driven (durante um estado)

- While o Grafo estiver em 2D, the system shall responder a hover, seleção,
  filtro e reenquadramento sem bloquear a thread de interface.
- While o Grafo estiver em 3D, the system shall carregar o renderer sob demanda
  e manter os controles de retorno e navegação responsivos.
- While o drawer estiver totalmente fechado, the system shall permanecer
  invisível, sem sombra, sem foco ativo e sem bloquear o conteúdo.
- While o chat estiver em viewport desktop ampla, the system shall permitir que
  tabelas e resultados estruturados usem largura maior que a coluna de prosa.
- While uma tabela ou região horizontal estiver manipulando toque ou ponteiro,
  the system shall reservar o gesto ao conteúdo.
- While a Fila reconciliar dados sem mudança semântica, the system shall
  preservar lista, rolagem, foco e ausência de skeleton.

### Optional (feature opcional)

- Where uma resposta histórica não possuir timestamps suficientes, the system
  shall omitir a duração em vez de calcular tempo desde a criação até agora.
- Where o usuário preferir movimento reduzido, the system shall abrir páginas e
  drawer sem deslocamentos decorativos e sem estados intermediários persistentes.
- Where um conteúdo histórico possuir tags inválidas, the system shall torná-lo
  elegível à reconciliação idempotente sem bloquear seu uso.

### Unwanted behavior (condições de erro)

- If um rótulo do Grafo exceder o espaço disponível, then the system shall
  truncar ou reposicionar o rótulo mantendo contraste e sem cobrir a viewport.
- If o renderer 3D falhar ou exceder seu orçamento de inicialização, then the
  system shall retornar ao renderer 2D e manter a navegação utilizável.
- If uma duração persistida for negativa, aberta ou incompatível, then the
  system shall omiti-la e não usar `Date.now()` como término de mensagem
  histórica.
- If uma rota apontar para um alias de chat, then the system shall aplicar a
  mesma taxonomia mobile da rota canônica.
- If uma tag corresponder a instrução de JSON, contagem, duplicação, sentença ou
  comentário do modelo, then the system shall descartá-la.
- If o carregamento de uma nota falhar, then the system shall manter o cabeçalho
  e um estado de erro local sem reapresentar conteúdo da rota anterior.

## Critérios de Aceite

- [ ] Hover e seleção no Grafo escuro mantêm rótulo legível e limitado ao
      canvas.
- [ ] Filtros, seleção de hub e alternância 3D/2D permanecem operáveis.
- [ ] O inspetor do Grafo não exibe `#`, `##`, fences ou marcadores de lista
      como texto cru no início do resumo.
- [ ] O editor de notas mantém Preview e Salvar dentro de 320, 390 e 768 pixels.
- [ ] `/` e `/chat` mostram o mesmo controle de menu no mobile.
- [ ] Drawer abre e fecha de forma determinística e termina sem sombra ou
      backdrop residual.
- [ ] Tabelas e código roláveis não iniciam o gesto do drawer.
- [ ] Mensagens concluídas não aumentam sua duração após remount ou reload.
- [ ] Timeline do chat usa descrições sanitizadas e não renderiza raciocínio
      bruto persistido.
- [ ] Tabelas do chat podem usar largura ampla no desktop e scroll próprio no
      mobile.
- [ ] Detalhe do job possui `h1` e “Voltar para fila” navega para `/fila`.
- [ ] Notas, configuração, integrações e páginas operacionais equivalentes usam
      o shell amplo; conteúdo textual mantém coluna interna legível.
- [ ] Novidades possui uma única ação de retorno por viewport.
- [ ] Transições lazy não substituem a página inteira por quadro vazio ou
      spinner central.
- [ ] Tags inválidas conhecidas são descartadas, tags equivalentes são
      deduplicadas e conteúdos sem tags válidas permanecem reconciliáveis.
- [ ] Fila permanece estável quando polling/SSE não alteram os dados.
- [ ] Histórico e composer do chat usam a mesma largura máxima no desktop.
- [ ] O botão de envio do chat usa o pictograma de envio, sem a letra “A”.
- [ ] O modal de atualização não exibe moldura roxa na região rolável ao abrir.
- [ ] `/extensao` usa o mesmo shell amplo das demais páginas operacionais.
- [ ] Páginas com título e descrição exibem eyebrow e ícone colorido animado.
- [ ] O conteúdo começa imediatamente após a reserva do topbar, sem padding
      vertical duplicado.
- [ ] Testes cobrem os contratos de hover, duração, navegação, drawer, toolbar,
      shells, jobs e tags.
- [ ] Lint, formatação, typecheck, testes e build passam sem Docker nem
      Playwright localmente.

## Fora de Escopo

- Adicionar provedores além da OpenRouter.
- Alterar os modelos canônicos de IA ou transcrição.
- Implementar transcrição local.
- Executar manualmente reprocessamento de conteúdo, Brain ou tags na instalação
  do owner durante a entrega; a migration apenas remove rótulos inválidos e
  devolve conteúdos sem tags à reconciliação idempotente existente.
- Executar Docker ou Playwright localmente.
- Garantir desempenho 3D em hardware sem WebGL compatível.

## Riscos / Decisões pendentes

- A timeline do chat privilegia transparência operacional segura; cadeia de
  raciocínio não é um artefato de produto.
- A largura ampla é aplicada ao shell da página. Formulários e prosa podem usar
  uma coluna interna menor sem recentralizar cabeçalhos equivalentes.
- Tags históricas inválidas conhecidas são removidas pela migration de deploy;
  conteúdos que ficarem sem tags voltam ao fluxo idempotente do worker.
