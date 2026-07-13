# Changelog

## v0.11.0-dev.1783967660 — 2026-07-13 · Dev

### 🛠️ Script de deploy automático no Easypanel pós-merge

Adicionado `scripts/easypanel-deploy.sh`: dispara o redeploy do `voxen-app` no Easypanel quando a `dev` avança para um SHA ainda não implantado, idempotente (marcador em disco evita redeploy duplicado do mesmo commit), com modo `--dry-run` e retentativa curta em falha transitória do Easypanel. O script não contém nenhuma credencial — a API key vem do ambiente. A configuração do gatilho (hook local que chama este script após cada merge) é feita separadamente, fora do controle de versão.

## v0.11.0-dev.1783913992 — 2026-07-13 · Dev

### ✨ Vox pesquisa, conecta e preserva melhor o contexto

O chat agora mantém o raciocínio visível depois de recarregar a página, pesquisa
a web e o X com os modelos configurados e procura automaticamente conteúdos
relacionados na Biblioteca antes de responder. Ao receber uma URL, a Vox aguarda
a ingestão e trabalha com resumo, tags e relacionados, abrindo a transcrição
completa somente quando necessário.

As pastas geradas por tags passam a exibir todo conteúdo associado, inclusive
quando um item possui várias tags. O MCP também entrega resumos e tags e orienta
agentes externos com o mesmo fluxo rico de recuperação, verificação e segurança.

## v0.11.0-dev.1783912875 — 2026-07-13 · Dev

### 🎨 Navegação mobile mais compacta

O cabeçalho flutuante e o botão que abre a navegação lateral agora ocupam menos
espaço em telas pequenas. Controles, avatar, margens e sombra foram suavizados
no mobile, mantendo a aparência atual do desktop.

## v0.11.0-dev.1783910846 — 2026-07-12 · Dev

### 🐛 Atualizações automáticas passam por todos os checks da PR

O bump de desenvolvimento agora reexecuta CI, segurança e validação de changelog
no contexto da própria PR. Isso permite publicar a nova versão e suas novidades
sem deixar o rollup preso em aprovação manual.

## v0.11.0-dev.1783907036 — 2026-07-12 · Dev

### 🐛 Novidades voltam a acompanhar cada atualização de desenvolvimento

O pipeline de versão agora substitui bumps obsoletos, executa os checks no build
correto e publica todas as notas acumuladas. A página Novidades e o modal de update
deixam de ficar presos em uma versão antiga após novos deploys.

## v0.11.0-dev.1783907036 — 2026-07-12 · Dev

### 🐛 Agente in-app ganha ferramenta para enfileirar transcrição de links compartilhados

O agente respondia que não tinha acesso à internet e não conseguia abrir links quando o usuário colava uma URL do YouTube, X ou qualquer página — apesar do Voxen ser justamente uma plataforma de ingestão de links. A causa era a falta de uma ferramenta de enfileiramento: o agente só enxergava tools de leitura sobre o que já estava transcrito no acervo. Agora ele também tem `request_transcription` (enfileira a URL nova, ou aponta direto a transcrição já existente) e `get_job_status` (acompanha o job até concluir), espelhando o par que o servidor MCP já usava para agentes externos.

## v0.11.0-dev.1783907036 — 2026-07-12 · Dev

### 🐛 Chat e outras telas não arrastam mais na horizontal no celular

Em telas menores, algumas áreas do app podiam ser arrastadas para os lados —
principalmente o chat, quando o resumo de uma ferramenta, um erro ou a própria
mensagem colada continha um link, token ou ID longo sem espaços, que esticava o
balão além da largura da tela em vez de quebrar linha.

Corrigimos os pontos de origem (detalhe de ferramenta e bolha de mensagem do
chat, mensagem de erro de execução de automações, corpo de notas de release no
modal de atualização e em "Novidades") e reforçamos como cinto de segurança os
principais containers de rolagem do app — conteúdo das páginas, modais e
diálogos — para nunca abrirem rolagem lateral, mesmo diante de um texto sem
quebra.

## v0.11.0-dev.1783907036 — 2026-07-12 · Dev

### 🎨 Grafo (/grafo) redesenhado para celular — controles, câmera 3D e visualização

A página do Grafo (Brain) tinha vários problemas específicos de celular, agora corrigidos:

- **Barra de controles menos poluída**: no celular, as estatísticas do grafo (transcrições,
  notas, pastas, conceitos, conexões) saem da fileira principal — que antes quebrava em
  várias linhas — e vão para um botão de informação dedicado, que abre um painel só com
  elas. Busca, alternância 2D/3D e atualizar continuam sempre visíveis, sem disputar espaço.
- **Câmera 2D por padrão no celular**: o grafo agora abre em modo 2D (arrastar move a
  câmera) em telas estreitas, em vez de 3D (arrastar gira a câmera) — girar com o dedo é um
  gesto ruim em touchscreen. No desktop o padrão continua 3D. O botão de alternar 2D/3D
  continua disponível nos dois casos.
- **Visualização sem WebGL adaptada à tela**: quando o navegador não suporta WebGL (fallback
  final, sem o grafo 3D nem o 2D acelerado), o desenho agora se ajusta à proporção real da
  tela em vez de assumir sempre paisagem — evita faixas vazias grandes em cima/embaixo em
  telas retrato (a maioria dos celulares).
- **Nós um pouco maiores em telas touch**: o alvo de toque mínimo dos nós do grafo aumenta
  em dispositivos touch, facilitando selecionar itens pequenos com o dedo.

## v0.11.0-dev.1783907036 — 2026-07-12 · Dev

### 🎨 Indicador de ambiente substitui o alternador manual de canal em Novidades

A página Novidades tinha três botões (Todas/Produção/Dev) que pareciam alternar entre ambientes,
mas na verdade só filtravam o histórico de notas — a instância nunca trocava de canal, sempre
mostrava o mesmo `releases.json` da imagem atual. Esses botões saíram e o histórico completo passa
a aparecer direto, sem filtro manual. No lugar, um indicador simples e não-clicável no topo da
página mostra em qual ambiente a instância atual está rodando — Desenvolvimento ou Produção —
derivado da versão real reportada pelo servidor, sem depender de escolha manual do usuário.

## v0.11.0-dev.1783907036 — 2026-07-12 · Dev

### 🎨 Fileira de pastas da Biblioteca não quebra mais com muitas pastas

Com as tags geradas por IA criando uma pasta automática para cada tag, o número de pastas
na Biblioteca cresceu rápido e a fileira de chips de pasta passou a quebrar em várias linhas,
ficando visualmente poluída. Agora a fileira mostra só as primeiras pastas (até um limite fixo)
e, quando há mais, um chip final "+K mais" abre um popover com busca — digite para filtrar por
nome entre todas as pastas e clique para selecionar, igual a um chip normal. Continua tudo como
antes: contagem de conteúdos por pasta, criação de pasta nova e destaque da pasta ativa (mesmo
quando ela está fora das primeiras exibidas).

## v0.11.0-dev.1783907036 — 2026-07-12 · Dev

### 🐛 Raciocínio da Vox corrigido e unificado com as ferramentas

O raciocínio da Vox (o "pensando" que aparece antes da resposta) agora é enviado
corretamente para o modelo — o parâmetro que pedia esforço de raciocínio estava no
formato errado para o OpenRouter e vinha sendo descartado silenciosamente pelo SDK,
o que fazia o raciocínio aparecer de forma inconsistente.

Na interface, raciocínio e ferramentas agora vivem dentro de um único bloco
"Pensando" / "Pensou por Xs", em vez de duas caixas separadas (raciocínio sempre
em cima, ferramentas sempre embaixo). Com o agente rodando várias etapas de
raciocínio intercaladas com buscas e leituras, o bloco agora mostra tudo na ORDEM
real em que aconteceu — cada nova ferramenta ou novo trecho de raciocínio aparece
na posição cronológica certa, então dá pra acompanhar o trabalho acontecendo em
tempo real em vez de ver uma caixa de raciocínio parada no topo enquanto o resto
roda embaixo, sem relação visual entre os dois.

Também corrigimos o botão "Ir ao mais recente" (aparecia esticado e mal
centralizado por um bug de CSS) e trocamos o ícone de enviar mensagem de avião de
papel para uma seta para cima.

## v0.11.0-dev.1783907036 — 2026-07-12 · Dev

### 🎨 Menu lateral recolhido por padrão, cabeçalho flutuante e chat como tela inicial no celular

O menu lateral agora abre recolhido (só ícones) por padrão em todas as páginas do
desktop — antes isso só acontecia no chat. Expandir fica salvo até você recolher de
novo. O cabeçalho também virou um bloco flutuante no canto superior direito, do
tamanho dos botões, e passou a aparecer no celular também (antes só existia no
desktop). E no celular, a tela inicial agora é o chat — igual ao desktop —, sem a
barra de navegação embaixo do campo de mensagem; pra acessar biblioteca, notas e
demais páginas, use o novo botão no canto superior esquerdo.

## v0.11.0-dev.1783907036 — 2026-07-12 · Dev

### 🐛 Consistência de tema em toda a aplicação (light legível, cards corretos)

Corrigimos textos ilegíveis e cards "cinzas fora do tema" no modo claro (e por tabela nos
temas escuros). Dezenas de telas usavam cores fixas que não trocavam junto com o tema —
agora todas usam os tokens semânticos do design system, então texto, superfícies e bordas
acompanham o tema ativo (zinc, emerald ou light). Também ajustamos o título de destaque, os
cards elevados e o fundo ambiente para deixarem de escurecer o tema claro.

## v0.11.0-dev.1783907036 — 2026-07-12 · Dev

### 🎨 Chat repaginado e ajustes de shell

O chat ganhou uma cara nova e profissional: bloco de ferramentas que mostra
"Trabalhando" com contador enquanto roda e colapsa num resumo (nº de ações,
famílias e duração) ao terminar, com cada ação abrindo o detalhe; raciocínio em
tempo real com efeito "Pensando" que vira "Pensou por Xs" recolhível; e um novo
composer com anexo de arquivos (imagem, áudio/vídeo e documentos entram direto no
acervo), estado do envio em chip e envio por Enter. O chat abre já no fim da
conversa e a barra de rolagem fica na borda da tela, com o conteúdo centralizado.

No shell, os botões de som e de limpar conversa passaram para o cabeçalho, ao lado
do avatar (só no chat), a sidebar recolhida no chat virou um rail de ícones com
atalhos e dica no hover, e o item "Início" saiu da navegação do desktop (onde a
tela inicial já é o chat).

## v0.11.0-dev.1783907036 — 2026-07-12 · Dev

### ✨ Tags de conteúdo geradas por IA na biblioteca

A biblioteca ganhou tags geradas por IA: a partir do título e do resumo/texto, o modelo atribui tags reaproveitando as já existentes (sem duplicar) e cada tag também cria/reaproveita uma pasta de mesmo nome. Um conteúdo pode ter várias tags, o que melhora a organização, a busca e a ligação entre conteúdos — a busca da biblioteca passa a casar por tag além do texto. Há botão para gerar tags de um conteúdo e para processar em lote os que ainda não têm tag.

## v0.11.0-dev.1783907036 — 2026-07-12 · Dev

### ✨ Harness de recuperação progressiva do agente

O agente in-app e o servidor MCP ganharam recuperação progressiva estilo editor de código com IA: busca textual forte (FTS), leitura de estrutura (outline), leitura por intervalo de linhas, por seção e por intervalo de timestamps, expansão de contexto anterior/posterior, busca de conteúdos relacionados e verificação determinística de citações. O fluxo evita mandar transcrições inteiras ao modelo — busca primeiro, abre só os trechos necessários e cita documento, linhas/seção e timestamp. Sem embeddings.

## v0.11.0-dev.1783907036 — 2026-07-12 · Dev

### 🎨 Chat redesenhado, temas e nova organização da home

O chat ganhou empty state no estilo SuperGrok, composer fixo, bloco de ferramentas/raciocínio mais limpo e botão para limpar a conversa com confirmação irreversível. A aplicação passa a ter temas zinc (padrão), emerald e light — selecionáveis no menu do usuário, com atalho claro/escuro no cabeçalho — e a preferência fica salva na conta. No desktop, `/` abre o chat; no mobile a home fica enxuta, o envio de links/arquivos vai para a Biblioteca e a fila de jobs ganha a rota `/fila`.

## v0.11.0-dev.1783907036 — 2026-07-12 · Dev

### ✨ Chat Vox persistente com ferramentas e memória resumida

O Vox passa a funcionar em uma única conversa contínua por conta. As respostas chegam em streaming, exibem raciocínio, fontes e chamadas de ferramentas, e podem pesquisar transcrições, notas e o Brain com isolamento por usuário. Quando o histórico fica longo, ele é resumido automaticamente sem perder o contexto recente. Ações de escrita em notas são propostas e só são executadas após aprovação explícita, e os sons de feedback são opcionais.

## v0.11.0-dev.1783824951 — 2026-07-11 · Dev

### 🎨 Home alinhada à Biblioteca

A Home agora usa a hierarquia visual compacta da Biblioteca. Os itens da fila podem ser selecionados por toda a linha: conteúdos concluídos abrem sua transcrição e os demais abrem o detalhe do processamento.

## v0.11.0-dev.1783821598 — 2026-07-12 · Dev

### 🎨 Erros de carregamento com "tentar novamente" e foco de teclado visível

Quando uma página falha ao carregar (rede ou servidor), em vez de mostrar um
estado "vazio" enganoso ela agora exibe um aviso claro de erro com um botão
**Tentar novamente**. E vários botões (abas, filtros de pasta, alternadores e o
fechar de modais) passaram a mostrar um anel de foco ao navegar por teclado,
melhorando a acessibilidade.

## v0.11.0-dev.1783821598 — 2026-07-12 · Dev

### ✨ Liga/desliga do Agente de Proxy com um switch

O Agente de Proxy residencial (que roteia a extração de mídia pelo seu IP de
casa quando o YouTube bloqueia downloads de datacenter) ganhou um **switch de
ativar/desativar** em Admin → Integrações. Desligar faz o servidor voltar a
baixar direto, sem apagar o token nem exigir reinstalar o agente — é só religar
o switch para voltar a rotear pelo agente.

## v0.11.0-dev.1783821598 — 2026-07-11 · Dev

### ✨ Regenerar títulos de todo o acervo com IA

Novo botão **Regenerar títulos** na biblioteca: reescreve com IA os títulos de
todos os conteúdos, drenando o acervo em lotes. Útil depois das melhorias na
geração de título (sempre em português, sem vazar o "raciocínio" do modelo) —
conteúdos antigos com título ruim são atualizados; os que já estão bons são
mantidos. Consome créditos de IA (uma chamada por conteúdo).

## v0.11.0-dev.1783821598 — 2026-07-11 · Dev

### 🧹 Simplificação das configurações da instância

Removidas duas seções de configuração que vão deixar de ser necessárias com o
amadurecimento da plataforma: a seção **"Operação da instância"** (email do
operador e timeout de resumo) na tela de configuração, e a seção **"Cookies do
yt-dlp"** em Integrações. A extração de mídia segue funcionando normalmente.

## v0.11.0-dev.1783821598 — 2026-07-11 · Dev

### 🎨 Grafo do Brain volta a ter 3D (com alternância 2D/3D)

O grafo do Brain volta a ser exibido em **3D** por padrão — dá para orbitar
arrastando e ver as conexões com profundidade, com o layout se acomodando de
forma animada. Um botão na barra do grafo alterna entre **3D** e **2D** a
qualquer momento, e a dica de controles se adapta ao modo escolhido.

## v0.11.0-dev.1783821598 — 2026-07-11 · Dev

### 🐛 Títulos deixam de vazar o "raciocínio" do modelo

Alguns conteúdos (posts do X, páginas web) recebiam como título o preâmbulo do
modelo — coisas como "The candidate title is…" ou "The user wants a final
title…", às vezes truncadas no meio. Agora a geração de título desabilita o
modo de raciocínio do modelo e rejeita qualquer resposta que pareça preâmbulo,
caindo no título original quando isso acontece.

## v0.11.0-dev.1783821598 — 2026-07-11 · Dev

### 🎨 Confirmações no tema do app e skeletons alinhados

As confirmações de ações destrutivas (apagar todas as pastas, cancelar um job)
deixaram de usar o pop-up nativo do navegador — agora abrem um modal de
confirmação no visual do Voxen, com botão destacado e spinner enquanto processa.
Os placeholders de carregamento (skeletons) passaram a usar a cor de superfície
do tema, combinando melhor com os cards.

## v0.11.0-dev.1783821598 — 2026-07-11 · Dev

### 🎨 Aviso de nova versão vira um modal com o que mudou

Quando sai uma versão nova enquanto você está usando o Voxen, no lugar do
antigo aviso discreto no canto agora aparece um **modal centralizado** — mostra
a versão nova, um resumo do que mudou (puxado das Novidades) e os botões para
recarregar na hora ou deixar para depois.

## v0.11.0-dev.1783821598 — 2026-07-11 · Dev

### 🐛 Grafo carrega sem travar (fim do erro 502)

Abrir o grafo do Brain deixou de recalcular a base inteira de forma síncrona
dentro da requisição — o que, em bibliotecas grandes, travava por dezenas de
segundos e resultava em erro 502. Agora a página responde na hora com o estado
atual e, quando há muito conteúdo para reindexar, o recálculo roda em segundo
plano; o grafo se atualiza sozinho no próximo carregamento.

## v0.11.0-dev.1783821598 — 2026-07-11 · Dev

### 🐛 Títulos gerados sempre em português

Quando o idioma da instância é português, o título automático de um conteúdo em
outro idioma (ex.: um vídeo do YouTube em inglês) agora é **traduzido/adaptado
para o português**, em vez de ser mantido no idioma original. Títulos que já
estão em português e são bons continuam sendo preservados.

## v0.11.0-dev.1783821598 — 2026-07-11 · Dev

### 🐛 Mensagem clara quando o proxy de download está fora do ar

Quando o download é roteado por um proxy (ex.: o Agente de Proxy residencial) e
esse proxy está indisponível, o job falhava com um erro técnico cru de "conexão
recusada". Agora a falha traz uma mensagem acionável: avisa que o proxy está
fora do ar e orienta a verificar o Agente de Proxy em Admin → Integrações, ou a
ajustar/remover o proxy para baixar direto pelo servidor.

## v0.11.0-dev.1783821598 — 2026-07-11 · Dev

### 🎨 Grafo do Brain mais leve e fluido

A visualização do **Voxen Brain** (`/grafo`) passou a usar a Reagraph, um
motor WebGL 2D. O grafo fica mais limpo e fácil de navegar (pan e zoom diretos,
destaque de vizinhança ao passar o mouse, clique para selecionar e duplo-clique
para abrir o item). O motor pesado é carregado só ao abrir a página, deixando o
resto do app mais rápido para carregar. Quando o navegador não tem WebGL, o
grafo continua caindo no desenho 2D determinístico de sempre.

## v0.11.0-dev.1783821598 — 2026-07-11 · Dev

### 🎨 Botão de Novidades na barra lateral

O rodapé da barra lateral deixou de exibir o número da versão e do commit. No
lugar entra um botão claro de **Novidades**, com ícone, que leva direto à página
de novidades ao clicar. Fica mais óbvio que dá para abrir o histórico de
mudanças, sem poluir o menu com informação técnica de build.

## v0.11.0-dev.1783821598 — 2026-07-11 · Dev

### 🐛 Grafo mais estável e limpar pastas sem erro 502

O reindex do Brain deixa de quebrar com erros de chave estrangeira sob carga
(reconciliação em paralelo). Apagar todas as pastas responde na hora — a limpeza
do grafo roda em background, sem estourar o proxy.

## v0.10.0-dev.1783761739 — 2026-07-11 · Dev

### 🐛 Versionamento em dev via PR (compatível com branch protection)

O bump automático `X.Y.Z-dev.timestamp` agora abre uma PR de versão e usa
auto-merge, respeitando a proteção da branch `dev` (sem push direto).

## v0.10.0-dev.1783761739 — 2026-07-11 · Dev

### 🐛 Correção do detector de PR de versão aberta

O workflow de versionamento em dev não criava a PR de bump porque a busca
de PRs abertas era ampla demais. Agora só considera títulos que começam com
`chore: set version to `.

## v0.10.0-dev.1783761739 — 2026-07-11 · Dev

### 🛠️ Versionamento automático em dev e changelog por PR

A cada merge em `dev`, o Voxen agora grava a versão no `package.json` no formato
`X.Y.Z-dev.<timestamp>` (commit `chore: set version to … for dev`), no mesmo
estilo da Orbital.

Além disso, cada PR de produto passa a incluir um arquivo em
`changelog/unreleased/` com a nota para o usuário final. No merge, a nota entra
em `releases.json` e no `CHANGELOG.md` — base da página de Novidades.

## v0.10.0-dev.1783761739 — 2026-07-11 · Dev

### ✨ Página de Novidades com o histórico de versões

Nova página **/novidades** na aplicação, acessível pelo rodapé da sidebar
(versão clicável). Lista as notas de changelog de dev e produção geradas
automaticamente a partir das PRs, com filtros por canal.

## v0.10.0-dev.1783761739 — 2026-07-11 · Dev

### 🎨 Biblioteca mais compacta, pastas e paginação

A página de **Transcrições** ficou mais densa e fácil de escanear:

- Cards em **lista minimalista** (thumb pequena, meta numa linha)
- Pastas em chips (Todas / Sem pasta / pastas) com visual mais limpo
- Botão **Apagar pastas** remove a organização sem apagar conteúdos — libera o Organizar com IA de novo
- **Carregar mais** com paginação real na API (24 itens por página)

## v0.10.0-dev.1783761739 — 2026-07-11 · Dev

### 🐛 Correção do workflow de versionamento em dev

O commit automático de versão em `dev` (`X.Y.Z-dev.timestamp`) volta a funcionar —
o arquivo do workflow tinha um erro de YAML no filtro do commit do bot.
