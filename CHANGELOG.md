# Changelog

## v0.13.0-dev.1785522932 — 2026-07-31 · Dev

### 🎨 Extensão de browser redesenhada com a identidade visual do Voxen

O popup e a página de opções da extensão de browser agora usam os mesmos
tokens de cor e a mesma tipografia do Voxen web (Bricolage Grotesque + Inter,
temas padrão/zinc/emerald/light) — antes a extensão tinha uma paleta
verde/indigo própria, sempre escura, desconectada do resto do produto.

- **Tema segue a instância conectada**: se você já tem um tema escolhido no
  Voxen (`Conta → Aparência`), a extensão aplica o mesmo tema assim que
  detecta a instância — tanto no popup quanto na página de opções. Sem
  instância conectada ainda, ela segue o esquema claro/escuro do sistema
  operacional.
- **Uma única tela de conexão**: a página de opções (`chrome-extension://.../options.html`)
  passa a ser a única superfície onde a extensão se conecta a uma instância
  Voxen. O popup não reimplementa mais esse formulário — quando ainda não há
  instância conectada, ele mostra um estado vazio com um botão que abre as
  opções, eliminando a duplicação de fluxo entre popup e opções.
- **Progresso mostra a etapa real**: enquanto um job está processando, o
  popup exibe a etapa atual (baixando, transcrevendo, gerando resumo…) em vez
  de um "Processando…" genérico, sempre que o status do job traz essa
  informação.
- Todos os estados existentes (detecção de instância, envio de aba,
  progresso, resultado com resumo, ações pós-envio) continuam disponíveis —
  nenhuma capacidade foi removida, só reorganizada.

## v0.13.0-dev.1785520081 — 2026-07-31 · Dev

### 🐛 Busca no acervo quebrava o turno inteiro do chat

Corrigido bug que fazia o agente de chat falhar sempre que usava a ferramenta de busca no acervo (`search_transcripts`) — um campo de data era devolvido em formato incompatível com o que o modelo de IA espera, derrubando a resposta inteira com erro técnico. O mesmo problema foi corrigido no servidor MCP.

## v0.13.0-dev.1785517091 — 2026-07-31 · Dev

### 🐛 Retry com impersonate=chrome do TikTok nunca era acionado

Corrigido bug de controle de fluxo que fazia a mitigação de retry do TikTok (forçar impersonation de browser via `curl_cffi` quando o download falha com "unable to extract universal data for rehydration") nunca ser executada — o erro já virava falha permanente antes do retry ter chance de rodar. O TikTok está passando por uma instabilidade conhecida e ainda não corrigida no `yt-dlp` upstream; esse retry agora funciona de verdade e recupera parte dos downloads que antes falhavam de cara.

## v0.13.0-dev.1785440574 — 2026-07-30 · Dev

### 🐛 Cabeçalhos, chat e atualização novamente consistentes

As páginas operacionais agora começam logo após o cabeçalho flutuante e usam um
padrão único de título, descrição, identificação da área e ícone colorido
animado. A página da extensão também passa a aproveitar a mesma largura das
demais telas.

O histórico do chat volta a acompanhar a largura do campo de mensagem, e o
botão de envio mostra um pictograma de envio claro. O modal de nova versão deixa
de desenhar uma moldura roxa ao redor de todo o conteúdo quando recebe foco.

## v0.13.0-dev.1785431966 — 2026-07-30 · Dev

### 🐛 Rótulos legíveis ao explorar o Brain

O hover dos nós do Grafo agora usa uma superfície compatível com o tema ativo,
mantendo título e fundo com contraste adequado no modo escuro. Títulos muito
longos também são limitados para não atravessarem toda a visualização.

## v0.13.0-dev.1785429740 — 2026-07-30 · Dev

### 🐛 Interface mais estável, legível e consistente

A navegação entre telas deixa de exibir conteúdo da rota anterior ou saltar o
scroll durante a troca. O carregamento preserva o shell da aplicação, e as
páginas operacionais passam a aproveitar melhor a largura disponível sem
alongar excessivamente textos de leitura.

No mobile, o menu lateral mantém animação, foco, sombra e bloqueio da página
sincronizados até o fim do gesto. O editor de notas reorganiza título, status e
ações para manter Preview e Salvar acessíveis em telas estreitas; `/` e `/chat`
também passam a compartilhar o mesmo comportamento de navegação.

O Grafo ganha contraste confiável ao passar o mouse ou selecionar nós, resumo
sem marcadores Markdown crus e preparação antecipada do modo 3D. No chat, a
timeline mostra estados operacionais seguros, preserva durações concluídas e
oferece mais espaço para tabelas e outros dados estruturados.

O aviso de nova versão ganhou uma área maior e rolável com cabeçalho e ações
sempre visíveis. Detalhes da fila e a página de novidades receberam correções
de hierarquia e navegação.

Por fim, instruções e comentários indevidos deixam de virar tags. Rótulos
históricos conhecidos são saneados no deploy e conteúdos que ficarem sem tags
voltam automaticamente ao processamento idempotente.

## v0.13.0-dev.1785406211 — 2026-07-30 · Dev

### 🐛 Configuração simples e interface estável no uso diário

A configuração da OpenRouter passa a pedir somente a chave de API e aplica
automaticamente os modelos recomendados para conversa, análise e transcrição.
O processamento continua especializado por formato: PDFs usam o parser Mistral,
outros documentos usam MarkItDown e imagens, áudio e vídeo seguem pela
OpenRouter.

Notificações agora aparecem uma por vez durante cinco segundos. A Fila mantém
os dados visíveis e reconcilia mudanças em segundo plano, sem trocar a lista por
skeletons periódicos nem reiniciar itens que não mudaram.

No mobile, gestos horizontais em tabelas, conteúdos roláveis e no canvas do
Grafo não abrem mais a sidebar, e o menu fechado não deixa sombra na lateral.
A atualização da aplicação também passa a respeitar a versão exata do build,
inclusive quando um service worker já está aguardando, e só ativa a nova versão
quando a pessoa confirma.

## v0.13.0-dev.1785376533 — 2026-07-29 · Dev

### 🐛 Atualizações deixam de prender a interface antiga

O aviso de nova versão passa a usar a versão exata do pacote e prepara a
atualização do app em segundo plano. Navegações online deixam de reutilizar o
HTML antigo do PWA, evitando que uma interface desatualizada continue ativa
depois de um deploy.

O modal mantém cabeçalho e ações sempre acessíveis e concentra a rolagem em uma
única região central, inclusive quando as notas da versão são extensas.

## v0.13.0-dev.1785366299 — 2026-07-29 · Dev

### 🐛 Atualizações e páginas com comportamento consistente

O aviso de nova versão agora mostra somente as notas da versão correta, mantém
cabeçalho e ações visíveis e permite rolar todo o conteúdo central por mouse,
trackpad, toque ou teclado. Carregamento, indisponibilidade e falha possuem
estados próprios, e adiar não é mais confundido com aplicar a atualização.

As páginas de conteúdo passaram a compartilhar larguras, margens e ritmo
vertical adequados a cada tipo de trabalho, aproveitando melhor a tela e
evitando mudanças bruscas de tamanho durante a navegação.

O chat também informa o início do preparo imediatamente, executa etapas
independentes em paralelo e registra separadamente o tempo interno e a espera
pelo primeiro evento do modelo.

## v0.13.0-dev.1785359396 — 2026-07-29 · Dev

### ✨ Superfícies mais claras, fluidas e prontas para uso

A navegação mobile deixa de repetir “Início” e passa a abrir um menu lateral
parcial que acompanha o gesto da borda ou do centro da tela, com foco contido,
fechamento acessível e respeito a movimento reduzido.

As telas de processamento agora descrevem a etapa real de vídeos, páginas,
documentos, imagens e conteúdo do X, preservam o histórico recebido em tempo
real e mostram a duração de cada fase sem redirecionar antes da conclusão.

O Brain passa a ser reconciliado mesmo sem visitas ao Grafo. Novos conteúdos
invalidam o snapshot e atualizam a página aberta em tempo real; o Grafo inicia
sempre na visualização completa e mantém os títulos legíveis no tema escuro.

Novidades ganhou fluxo contínuo, busca, filtros e paginação. O aviso de nova
versão ficou maior, explica a mudança de versão e oferece acesso direto ao
histórico completo. O onboarding continua simples, enquanto a configuração
avançada dos modelos permanece disponível para administradores.

## v0.13.0-dev.1785355315 — 2026-07-29 · Dev

### ✨ Interface mais clara, densa e consistente

A Voxen ganhou uma nova fundação visual inspirada nos princípios de hierarquia
e foco do Linear. O tema escuro principal, a sidebar mais confortável, os
ícones animados e os novos layouts reutilizáveis aproveitam melhor a tela sem
adicionar ruído.

As transições também respeitam a preferência de movimento reduzido, e a
navegação mobile mantém o drawer leve e sem destinos redundantes.

## v0.13.0-dev.1785351539 — 2026-07-29 · Dev

### ✨ OpenRouter pronta para uso com uma única chave

O onboarding agora pede somente a chave da OpenRouter e configura
automaticamente os modelos recomendados para conversa, transcrição, imagens,
documentos, pesquisa e conteúdo do X. O administrador continua podendo trocar
cada modelo depois na página de Configuração.

PDFs passam a usar o parser Mistral OCR pela OpenRouter. A geração automática de
tags também ficou mais confiável: respostas estruturadas evitam tags vazias e
conteúdos incompletos entram numa reconciliação em segundo plano, com tentativas
limitadas e diagnóstico preservado.

## v0.13.0-dev.1785340742 — 2026-07-29 · Dev

### ✨ Chat mobile e ingestão de links mais confiáveis

- Melhora a abertura do menu no mobile, a biblioteca de notas e as telas de atualizações.
- Mostra o andamento real de transcrições e análises, inclusive após reconectar a página.
- Trata links enviados no chat de acordo com a intenção: processa quando solicitado e pede esclarecimento quando necessário.

## v0.13.0-dev.1785219429 — 2026-07-28 · Dev

### 🐛 Chat mais estável, rápido e confiável

O chat agora descreve corretamente o que está fazendo antes de responder, prepara em paralelo
as informações independentes de que precisa e mede o tempo de raciocínio desde o início real da
solicitação.

Também corrigimos a confirmação de criação de notas, inclusive para os identificadores usados
pelo provedor de IA, e reduzimos remontagens e movimentos involuntários da conversa durante
respostas e recuperações.

## v0.12.0-dev.1785168327 — 2026-07-27 · Dev

### 🔒 Atualização de segurança nos componentes internos da Voxen

Atualizamos dependências internas usadas pela Voxen para versões com correções de segurança. A experiência de uso permanece a mesma, com uma base mais protegida para capturas, Biblioteca, chat e administração.

## v0.11.0-dev.1785165340 — 2026-07-27 · Dev

### 🐛 Brain mantém embeddings consistentes durante atualizações

Quando os embeddings opcionais são atualizados, a Voxen agora coordena essa escrita com a atualização do Brain. Isso evita que um embedding concorra com a reconstrução do mapa de conhecimento do mesmo usuário.

Se a coordenação estiver ocupada ou indisponível, o embedding é ignorado com segurança e pode ser atualizado em uma próxima execução, sem deixar o Brain em estado parcial.

## v0.11.0-dev.1785163369 — 2026-07-27 · Dev

### ⚡ Telas mais rápidas ao navegar pela Voxen

Chat, Biblioteca, Notas, Grafo, Automações e Administração passam a ser preparados somente quando você abre cada área. Isso reduz o trabalho do primeiro acesso, especialmente em conexão móvel e no app instalado.

Ao trocar de tela, a navegação continua visível e a área de conteúdo mostra um indicador de carregamento acessível enquanto a página é preparada.

## v0.11.0-dev.1785161161 — 2026-07-27 · Dev

### ⚡ Biblioteca encontra tags grandes sem pesar no celular

A Biblioteca passa a carregar só as tags mais relevantes na tela inicial. Ao abrir o seletor, você pode buscar uma tag e carregar mais resultados sem trazer o catálogo inteiro para o celular.

Isso mantém a organização por tags rápida mesmo quando a base de conhecimento cresce, preservando os filtros combinados de pasta, Inbox, semana, status e busca.

## v0.11.0-dev.1785159812 — 2026-07-27 · Dev

### ✨ Biblioteca Viva organiza conteúdos por semana, Inbox, pastas e tags

A Biblioteca agora separa os conteúdos por semana de captura e permite reduzir o acervo pela semana atual ou anterior. O Inbox destaca materiais que ainda não entraram em uma pasta, enquanto pastas e tags aparecem como filtros visíveis com contagem de conteúdos.

As combinações de busca, período, pasta, tag e status permanecem na URL para que uma organização possa ser compartilhada ou retomada. A Vox também recebe a pasta, tags e data de captura nos resultados da Biblioteca, deixando suas sugestões e leituras de contexto mais situadas.

## v0.11.0-dev.1785155159 — 2026-07-27 · Dev

### ✨ Voxen fica mais confiavel como app no celular

O Voxen agora oferece instalacao como app no Android e instrucoes claras para adicionar ao Inicio no Safari do iPhone/iPad. A experiencia instalada acompanha melhor o tema escolhido e deixa de travar a orientacao da tela em retrato.

Atualizacoes aguardam o fim de respostas em andamento antes de recarregar, preservando a sessao e o cache do app. Quando a conexao cai, a tela informa o problema e permite tentar novamente, sem tratar uma falha temporaria como logout.

Tambem ampliamos os alvos de toque no celular e melhoramos a acessibilidade dos dialogos de Automacoes, incluindo foco e fechamento por teclado.

## v0.11.0-dev.1784459422 — 2026-07-19 · Dev

### ✨ Extensão v0.2 — design, resumo do job e conexão em um clique

A extensão de browser ganhou visual moderno, detecção automática da
instância aberta, acompanhamento do processamento com notificação e
resumo quando o conteúdo fica pronto, além de aviso de atualização
consultando a própria instância.

## v0.11.0-dev.1784455991 — 2026-07-19 · Dev

### ✨ Extensão Chromium sideload para capturar a aba atual

Nova extensão Manifest V3 (Chrome/Edge/Brave) que envia a URL da aba para
`POST /api/jobs/auto` da instância configurada, com página `/extensao` na
sidebar para baixar o ZIP e instruções de instalação sideload.

## v0.11.0-dev.1784454827 — 2026-07-19 · Dev

### 🛠️ Deploy no Easypanel só no commit de versão (mensagem limpa)

O script de deploy manual só aceita HEAD no formato
`set version to X.Y.Z-dev.<timestamp>` — o mesmo padrão do Orbital, em que o
deploy roda depois do version-dev. Assim o log do Easypanel deixa de mostrar
o body inteiro da PR de feature e passa a mostrar só a linha de versão.

## v0.11.0-dev.1784451878 — 2026-07-19 · Dev

### 🐛 Capas estáveis no S3 e deploy Easypanel só manual

Capas de vídeo/página (especialmente TikTok) deixam de apontar para CDN
assinada no navegador: na ingestão a imagem é espelhada no storage e a
UI usa só `/api/transcripts/:id/preview` (com placeholder se a CDN já
tiver bloqueado). Também dá para pedir `POST .../refresh-thumbnail`.

O script de deploy do Easypanel agora exige `VOXEN_ALLOW_DEPLOY=1` —
sem isso não dispara redeploy (auto-deploy desligado de verdade).

## v0.11.0-dev.1784450551 — 2026-07-19 · Dev

### 🎨 Fonte original sob o título e grafo com núcleo centralizado

Na página do conteúdo, o link da origem (YouTube, TikTok, web…) fica logo
abaixo do título, clicável e legível. Na lista, o host da fonte aparece
junto dos metadados.

No grafo, a maior comunidade (concentração de ligações) fica no centro da
cena; a câmera abre e reenquadra nesse núcleo. As cores dos títulos dos
nós ganharam mais contraste (texto + contorno) no 2D e no 3D.

## v0.11.0-dev.1784447963 — 2026-07-19 · Dev

### 🔒 Atualizações de segurança em dependências transitivas

Corrige alertas do Dependabot em dependências de build e do worker:

- `shell-quote` 1.8.4 (crítico, dev)
- `js-yaml` 4.2.0 e `@babel/core` 7.29.6 (tooling)
- `aiohttp` ≥ 3.14.1 no worker (transitiva do S3/scraper)

## v0.11.0-dev.1784447963 — 2026-07-19 · Dev

### 🛠️ Higiene open-source e mensagens mais claras no guard de changelog

Removemos referências internas de lab da documentação de fluxo e dos
comentários de deploy, e o CI agora explica com mais clareza o que falta
quando uma PR não inclui o arquivo de changelog.

## v0.11.0-dev.1784444893 — 2026-07-19 · Dev

### 🧹 Deploy manual e commits de versão limpos em dev

- Imagem Easypanel deixa de ser publicada em todo push de `dev` (só tag de release ou `workflow_dispatch`).
- Bump de versão em dev passa a commitar/squashar como `set version to X.Y.Z-dev.<ts>` (sem `chore:`/`for dev`/`(#N)` no subject do squash).
- Script de deploy Easypanel documentado como manual (sem hook pós-pull).

## v0.11.0-dev.1784443300 — 2026-07-19 · Dev

### ✨ Reprocessar só o cérebro no grafo (sem gastar IA nem mexer no conteúdo)

- Botão “Reprocessar cérebro” no `/grafo` com confirmação clara do que muda.
- Reconstrói o mapa a partir do que já está salvo; não regenera tags, resumos nem extract LLM.
- Preserva arestas `llm-grounded` e manuais no reprocesso heurístico.

## v0.11.0-dev.1784440910 — 2026-07-19 · Dev

### ✨ Compile grounded no Brain, clusters no mapa e embeddings opt-in

- Após a ingestão, extrai entidades e claims com trecho literal (grounding) via OpenRouter.
- Mapa rápido passa a mostrar hubs de comunidade (clusters) para grupos com 3+ nós.
- Embeddings opcionais no metadata do conteúdo, com reordenação híbrida na busca FTS quando habilitados.

## v0.11.0-dev.1784437723 — 2026-07-19 · Dev

### ✨ Mapa do Brain rápido (2D padrão, recorte e arestas fortes)

- Abre o grafo em 2D por padrão e só carrega 3D sob demanda.
- `GET /api/graph?view=map` devolve um recorte enxuto (≤180 nós); `view=full` e `focus` cobrem o restante.
- Omite arestas fracas de co-ocorrência no mapa e eleva o limiar de RELATED_TO no indexador.
- Documenta LangExtract (padrão de grounding, sem a lib) e a estratégia do mapa em ADRs.

## v0.11.0-dev.1784433253 — 2026-07-19 · Dev

### 🐛 Chat não cai mais com network error ao transcrever links

- Mantém o stream SSE vivo durante transcrições longas (keepalive + idleTimeout do Bun).
- Desconexões de transporte recuperam o turno em andamento sem toast de network error.
- Rate limit do YouTube em legendas volta a cair no Whisper em vez de falhar o job.
- Filtra tags geradas com raciocínio do modelo (ex.: "Looking at the content").

## v0.11.0-dev.1784197604 — 2026-07-16 · Dev

### 🐛 Chat resiliente e experiência mobile contínua

- Mantém respostas longas em execução mesmo quando o PWA perde a conexão e retoma turnos após reinícios.
- Continua a resposta final depois que a transcrição de um link termina, sem deixar o chat preso.
- Abre conversas extensas com paginação, melhora áreas seguras e formulários mobile e estabiliza o foco do grafo 3D.

## v0.11.0-dev.1784187494 — 2026-07-16 · Dev

### 🎨 Conversas mais discretas e sem atalhos fora de hora

O botão **Ir ao mais recente** agora aparece somente depois que você se afasta
intencionalmente do fim da conversa. Ele não surge mais ao abrir um chat novo,
durante o pensamento da Vox nem por causa do posicionamento automático das
mensagens.

Na página de uma transcrição, o campo contextual de conversa virou um dock fino:
uma faixa de 32 px permanece visível e o compositor completo se abre com hover,
foco ou toque. Rascunhos mantêm o dock aberto, e o envio com `Enter` continua
levando a pergunta para o chat canônico com o contexto da transcrição.

## v0.11.0-dev.1784187494 — 2026-07-16 · Dev

### 🐛 Brain 3D estável, centralizado e mais fácil de navegar

O Brain deixa de alternar indefinidamente entre passes de indexação incompatíveis:
o indexador rápido agora preserva a versão completa já registrada, enquanto o
passe completo também reconhece a cobertura mínima atendida. Isso evita ciclos de
**Organizando** e falhas de cobertura em conteúdos que já foram processados.
O estado completo só é registrado depois que fontes, pastas, conceitos e relações
terminam; se uma etapa falhar, a fonte continua pendente para uma nova tentativa.
Web e worker agora compartilham uma única trava distribuída por workspace: eles
não reescrevem o mesmo Brain ao mesmo tempo, e uma indisponibilidade temporária
mantém o snapshot atual em vez de iniciar trabalho concorrente. Mudanças de fonte
e nós órfãos também são detectados e reconciliados automaticamente. Um heartbeat
renova a trava durante passes longos sem adicionar uma chamada Redis a cada etapa.

No modo 3D, a maior comunidade passa a ocupar o centro real da cena e é o foco do
primeiro enquadramento. Comunidades menores ficam distribuídas ao redor do núcleo,
com controles separados para aproximar, afastar, focar o núcleo e mostrar todo o
grafo.

## v0.11.0-dev.1784146544 — 2026-07-15 · Dev

### ⚡ Brain 3D abre com estabilidade e permanece centralizado

O mapa do Brain agora acompanha a indexação por um status leve, sem baixar e
reconstruir todos os nós e relações repetidamente. O trabalho é coordenado no
Redis e pode ser retomado com segurança após reinícios, enquanto falhas reais
param o ciclo e oferecem uma tentativa explícita em vez de carregar para sempre.

A distribuição 3D também passa a nascer centralizada na origem, reenquadra a
câmera quando a topologia muda e usa cores compatíveis com o renderer, reduzindo
travamentos e avisos repetidos durante a navegação.

## v0.11.0-dev.1784133009 — 2026-07-15 · Dev

### ⚡ Brain 3D persistente e fluido

O Voxen Brain volta a abrir diretamente em 3D com um layout tridimensional
determinístico, adaptativo e sem simulação contínua. O renderer permanece
montado durante interações e atualizações, evitando o acúmulo de contextos
WebGL. A rotação volta a responder diretamente ao gesto, o contexto prioriza
desempenho e o fallback 2D cobre ausência ou falha de WebGL2 sem quebrar com
tipos semânticos de nós.

## v0.11.0-dev.1784126586 — 2026-07-15 · Dev

### ⚡ Grafo do Brain mais rápido e explorável

# Grafo do Brain mais rápido e explorável

- A visão 2D passa a abrir primeiro, com o modo 3D carregado somente quando
  solicitado.
- A página ganha filtros, hubs, comunidades, inspeção de nós e controles de
  navegação organizados em uma interface compatível com todos os temas.
- A atualização do Brain deixa de bloquear a resposta enquanto reindexa e
  passa a informar o progresso automaticamente.
- A conversa canônica passa a tolerar a disputa de criação observada pela
  suíte concorrente do CI.

## v0.11.0-dev.1784083142 — 2026-07-14 · Dev

### 🎨 Detalhe da transcrição com copiar resumo e barra de chat

Página de conteúdo ganha botão de copiar o resumo, promptbox sticky no estilo do
chat (Enter envia e abre a conversa com o contexto do item) e hierarquia visual
mais limpa.

## v0.11.0-dev.1784081644 — 2026-07-14 · Dev

### ✨ Tags geradas automaticamente ao adicionar links e conteúdos

O worker passa a criar tags por IA após o resumo de cada job (vídeo, web, upload,
X). Conteúdos novos deixam de chegar sem tags; falhas de tag não derrubam o job.

## v0.11.0-dev.1784081644 — 2026-07-14 · Dev

### ✨ Fuso horário da instância e relógio da Vox no chat

Configuração IANA de fuso no onboarding, em Configurações e em Admin → Usuários.
A cada turno o agente recebe data/hora local, dia da semana, offset e marcos UTC
para “hoje” / “esta semana” sem adivinhar o fuso do servidor.

## v0.11.0-dev.1784078888 — 2026-07-14 · Dev

### 🐛 Âncora da mensagem no topo não some na primeira ferramenta

O reengage do stick-to-bottom só ocorre com espaçador esgotado e após
começar o texto final da resposta (ou ao fim do turno). Tools e raciocínio
sozinhos não desancoram a mensagem enviada.

## v0.11.0-dev.1784078888 — 2026-07-14 · Dev

### 🐛 Vox deixa de falar em nomes de ferramentas pro usuário

O system prompt proíbe citar tools, parâmetros e IDs internos na resposta
final. Próximos passos passam a ser em linguagem natural de produto.

## v0.11.0-dev.1784078888 — 2026-07-14 · Dev

### 🐛 Bloco Pensando deixa de piscar entre ferramentas

O bloco de raciocínio do chat fica aberto enquanto o turno está ao vivo
(`live`) e só recolhe quando o stream termina — gaps entre tool-results
não colapsam mais a timeline.

## v0.11.0-dev.1784074880 — 2026-07-14 · Dev

### 🐛 Erro de ferramenta deixa de travar o chat em “Pensando…”

Falhas de tool (ex.: transcrição) passam a marcar erro de verdade, curam
estados `running` órfãos e mostram fallback legível. O status inicial do
turno agora é “Buscando na sua biblioteca…”.

## v0.11.0-dev.1784073052 — 2026-07-14 · Dev

### 🎨 Chat ancora a mensagem enviada no topo e deixa espaço para a resposta

Ao enviar uma mensagem, a bolha do usuário sobe para o topo da área do chat
(estilo ChatGPT/Orbital) e a resposta nasce no espaço abaixo. Um espaçador
encolhe durante o stream para evitar saltos; rolar para cima cancela o
acompanhamento automático.

## v0.11.0-dev.1784071986 — 2026-07-14 · Dev

### ✨ Agente lista acervo por data de ingestão (resuma minha semana)

Novas tools `list_transcripts` e `list_notes` com `since`/`until` em `createdAt`.
Perguntas como “resuma minha semana” passam a listar o intake real da janela
antes de ler e sintetizar — sem depender só de busca por termo.

## v0.11.0-dev.1784065901 — 2026-07-14 · Dev

### 🐛 Chat deixa de quebrar no AI SDK 7 com histórico SYSTEM

Conversas com resumo de compactação ou resposta HITL voltam a responder
normalmente. O runtime passa a permitir mensagens SYSTEM confiáveis do
servidor no `streamText` e a compactação usa `instructions` em vez de
`system`.

## v0.11.0-dev.1784065901 — 2026-07-14 · Dev

### 🎨 Chat mais calmo no markdown, com copiar mensagem e chrome mobile transparente

Links e código inline nas respostas da Vox deixam de aparecer como badges
fortes. Dá para copiar a mensagem do usuário ou da IA pelo botão abaixo do
texto. No celular, o cabeçalho fica transparente e do mesmo tamanho do botão
da sidebar, com o histórico passando por baixo.

## v0.11.0-dev.1784062200 — 2026-07-14 · Dev

### 🐛 Confirmações antigas de nota voltam a funcionar ou somem do chat

Pedidos de criação de nota feitos antes da pausa HITL — que apareciam no card
acima do prompt mas falhavam com “não encontrada ou já utilizada” — agora são
recuperados a partir do conteúdo ainda salvo na mensagem, ou o card é removido
quando a confirmação já tinha sido usada.

## v0.11.0-dev.1784061257 — 2026-07-14 · Dev

### 🐛 Confirmação de nota antiga deixa de ficar presa no chat

Ao confirmar uma proposta de nota que ficou pendente sob muitas respostas
posteriores da IA, o card de confirmação agora some corretamente. Antes, só as
últimas mensagens eram atualizadas e o pedido podia reaparecer como se ainda
estivesse aberto.

## v0.11.0-dev.1784059366 — 2026-07-14 · Dev

### ✨ Confirmação da IA pausa o chat e fica acima do prompt

Quando a Vox propõe criar uma nota, o turno agora pausa de verdade em vez de continuar “pensando” em volta do botão. O pedido de confirmação aparece logo acima da caixa de mensagem, sobrevive se você sair e voltar depois, e não expira por tempo. No celular, os botões do cabeçalho direito ficam do mesmo tamanho do botão que abre o menu.

## v0.11.0-dev.1783971428 — 2026-07-13 · Dev

### 🐛 Chat quebrava para sempre após aprovar criação de nota via IA

Corrigido crash que derrubava o chat inteiro (tela "Algo deu errado") sempre que uma conversa com uma confirmação de nota aprovada era carregada. A causa era um dado malformado gravado na mensagem de confirmação, que o render de ferramentas não conseguia interpretar. Também foi adicionada uma validação de segurança para que dados malformados (deste ou de qualquer bug futuro) nunca mais consigam quebrar o chat inteiro — são simplesmente ignorados no render.

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
