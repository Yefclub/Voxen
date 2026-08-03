# Spec 116 — Superfícies de produto prontas para uso

## Contexto

A fundação visual Linear, a ingestão OpenRouter-only e a atualização automática
do Brain já existem. As superfícies que expõem esses recursos ainda apresentam
contratos divergentes: o onboarding deve ser simples sem eliminar a configuração
avançada posterior; a navegação mobile possui nomenclatura redundante e um drawer
que não acompanha o gesto; jobs em tempo real usam rótulos genéricos; o grafo
ainda inicia no recorte rápido e pode depender da abertura da página para
reconciliação; novidades e o modal de atualização usam layouts fragmentados.

Esta spec consolida os comportamentos necessários para que essas experiências
sejam claras, acessíveis, responsivas e coerentes antes da divulgação da
plataforma.

## Glossário

- **Onboarding**: fluxo inicial obrigatório do primeiro administrador.
- **Configuração de modelos**: superfície administrativa posterior ao onboarding.
- **Snapshot do grafo**: conjunto materializado de nós e arestas disponível para leitura.
- **Evento de job**: registro persistido de uma etapa operacional de ingestão.
- **Release**: entrada do histórico de novidades da aplicação.

## Requisitos

### Ubiquitous (sempre verdadeiros)

- The system shall solicitar somente a chave OpenRouter na etapa de IA do onboarding.
- The system shall manter uma superfície administrativa separada para configurar os modelos usados por cada capacidade.
- The system shall aplicar automaticamente os modelos padrão ao validar uma chave durante o onboarding.
- The system shall representar a rota raiz como Chat, sem apresentar um destino “Início” redundante na navegação mobile.
- The system shall manter ações mobile com alvo de interação mínimo de 24 por 24 pixels CSS.
- The system shall apresentar rótulos de progresso compatíveis com o tipo de conteúdo processado.
- The system shall preservar eventos de job em ordem cronológica, sem duplicação entre snapshot, SSE e polling.
- The system shall abrir o grafo com o snapshot completo, sem oferecer o antigo modo rápido.
- The system shall manter texto de nós legível em repouso, hover e seleção nos temas claro e escuro.
- The system shall apresentar novidades em um fluxo contínuo de uma coluna.
- The system shall respeitar a preferência de movimento reduzido em drawers, páginas, timelines e modais.

### Event-driven (resposta a evento)

- When uma chave OpenRouter válida for confirmada no onboarding, the system shall persistir a chave e todos os modelos padrão sem solicitar escolhas adicionais.
- When o administrador abrir a configuração depois do onboarding, the system shall permitir validar a chave existente ou uma nova chave e alterar os modelos disponíveis.
- When o usuário arrastar horizontalmente do centro para a direita em uma área não interativa no mobile, the system shall mover o drawer proporcionalmente ao gesto e concluir ou cancelar a abertura conforme o limiar.
- When o drawer mobile abrir, the system shall confinar o foco, tornar a superfície externa inerte e permitir fechamento por Escape, backdrop, botão explícito e gesto inverso.
- When um evento de job chegar por SSE, the system shall atualizar somente o job afetado e anunciar a etapa atual sem remontar a timeline existente.
- When o SSE de um job desconectar durante processamento, the system shall indicar reconexão e atualizar o snapshot por polling até a conexão retornar ou o job terminar.
- When um conteúdo, nota, pasta ou tag alterar relações do Brain, the system shall atualizar o índice e invalidar o snapshot do grafo sem depender da visita à página.
- When um snapshot do grafo for invalidado enquanto a página estiver aberta, the system shall buscar a versão nova sem bloquear a interação corrente.
- When o usuário aplicar filtros ou paginação em novidades, the system shall refletir o estado na URL e retornar somente o recorte solicitado.
- When uma nova versão estiver disponível, the system shall apresentar versão anterior, versão nova, mudanças prioritárias e ações de atualizar, adiar e abrir o histórico completo.

### State-driven (durante um estado)

- While o drawer mobile estiver fechado, the system shall manter sua estrutura pronta sem executar trabalho pesado de renderização a cada gesto.
- While um job estiver ativo, the system shall mostrar etapa contextual, percentual, conexão em tempo real e duração transcorrida.
- While o grafo estiver recebendo uma atualização de snapshot, the system shall manter o snapshot anterior visível e interativo.
- While novidades estiverem carregando outra página, the system shall preservar releases e filtros já exibidos.
- While uma resposta de IA renderizar uma tabela, the system shall preservar semântica de tabela e permitir rolagem horizontal em telas estreitas.

### Optional (feature opcional)

- Where o conteúdo possuir URL externa, the system shall permitir abrir a fonte original a partir do job e do item processado.
- Where uma release possuir mudanças promovidas, the system shall permitir expandi-las sem transformar a página em duas colunas.
- Where o dispositivo informar movimento reduzido, the system shall substituir deslocamentos por transições instantâneas ou discretas.

### Unwanted behavior (condições de erro)

- If a chave OpenRouter não disponibilizar os modelos padrão durante o onboarding, then the system shall explicar a indisponibilidade sem avançar nem solicitar configuração manual.
- If a configuração avançada enviar somente parte dos modelos obrigatórios, then the system shall rejeitar a alteração sem modificar a configuração existente.
- If um gesto começar em link, botão, campo, editor ou controle interativo, then the system shall não abrir nem fechar o drawer.
- If um evento de job possuir etapa desconhecida, then the system shall mostrar um fallback humano e não expor o identificador interno cru.
- If a atualização do grafo falhar, then the system shall manter o snapshot anterior e oferecer nova tentativa sem esvaziar o canvas.
- If filtros de novidades forem inválidos, then the system shall normalizá-los para valores suportados.
- If o modal de atualização não conseguir carregar releases, then the system shall continuar permitindo atualizar, adiar ou abrir novidades.

## Critérios de Aceite

- [ ] O onboarding valida a chave e avança sem renderizar seletores de modelos.
- [ ] A configuração administrativa continua listando e salvando modelos por capacidade.
- [ ] A navegação mobile apresenta Chat, Biblioteca, Notas, Grafo e Perfil sem “Início”.
- [ ] O drawer acompanha o gesto, possui largura parcial, focus trap, backdrop e reduced motion.
- [ ] Testes cobrem gestos válidos, cancelados, verticais e iniciados em controles.
- [ ] Jobs de vídeo, web, imagem, documento e upload recebem rótulos contextuais.
- [ ] Snapshot, SSE e polling preservam uma timeline sem duplicatas.
- [ ] A tela de job mostra duração e estado da conexão sem navegação automática prematura.
- [ ] Novos conteúdos, notas, pastas e tags atualizam o Brain fora da página do grafo.
- [ ] `/grafo` solicita somente o snapshot completo e não renderiza controle de modo rápido.
- [ ] Falhas de atualização do grafo preservam o snapshot anterior.
- [ ] Labels de nós mantêm contraste verificável nos temas claro e escuro.
- [ ] `/novidades` usa uma coluna, busca, filtros de canal/tipo e paginação.
- [ ] Filtros e página de novidades sobrevivem a reload por parâmetros da URL.
- [ ] O modal de versão utiliza espaço maior e uma lista contínua de mudanças.
- [ ] Controles novos atendem alvo mínimo, foco visível e reduced motion.
- [ ] Lint, typecheck, testes TypeScript/Python, build e verificações de segurança passam.

## Fora de Escopo

- Adição de provedores de IA além da OpenRouter.
- Transcrição local.
- Colaboração multiusuário em tempo real.
- Substituição dos renderizadores 2D e 3D do grafo.
- Alteração dos modelos padrão definidos na spec 114.
- Execução local de Docker ou Playwright.

## Riscos / Decisões pendentes

- O gesto central pode competir com carrosséis ou editores; áreas interativas e
  superfícies com opt-out explícito não participam do gesto.
- O snapshot completo do grafo pode crescer; os perfis de renderização existentes
  continuam reduzindo labels e animações conforme a densidade.
- A configuração avançada preserva flexibilidade, mas não participa do onboarding.

> 2026-07-29: a configuração avançada de modelos foi mantida fora do onboarding por decisão explícita do usuário.
