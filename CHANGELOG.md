# Changelog

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
