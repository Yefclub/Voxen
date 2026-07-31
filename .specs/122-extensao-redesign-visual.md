# 122 — Redesign visual e de fluxo da extensão

## Contexto

A extensão Voxen (popup, página de opções, página `/extensao` no app web)
foi construída com uma identidade visual própria (gradiente
verde/indigo, `color-scheme: dark` fixo) desconectada do resto do produto.
O Voxen web usa um sistema de tokens semânticos (`--color-app-*`,
`--color-accent-*`) com múltiplos temas (padrão, zinc, emerald, light) e
tipografia própria (`Bricolage Grotesque` para display, `Inter` para
corpo) — a extensão não usa nada disso, tem sua própria paleta hardcoded, e
não responde ao tema escolhido pelo usuário no app nem ao esquema
claro/escuro do sistema.

Além da identidade visual, há duplicação de fluxo: o popup tem uma seção
"Conecte sua instância" e a página de opções tem outra versão quase idêntica
do mesmo formulário — duas superfícies fazendo a mesma coisa.

Esta spec cobre o redesign da extensão como um todo (popup, opções, página
de instalação `/extensao`). Não inclui a funcionalidade de captura de
cookies (spec 121) nem auto-update (decisão: fora de escopo, ver spec 121
"Fora de Escopo") — mas o redesign deve deixar espaço estrutural para as
telas de "conectar plataforma" que a spec 121 introduz.

## Glossário

- **Identidade visual do Voxen**: os tokens `--color-app-*`/`--color-accent-*`
  e as fontes já definidas em `apps/web/src/client/index.css`, com suporte
  aos temas existentes (padrão, zinc, emerald, light).
- **Superfície de configuração**: qualquer tela onde o usuário conecta a
  extensão à sua instância (hoje duplicada entre popup e options).

## Requisitos

### Ubiquitous

- The system shall usar os mesmos tokens de cor semânticos e tipografia do
  Voxen web em toda superfície da extensão (popup, opções, `/extensao`) —
  nenhuma cor ou fonte hardcoded independente do tema do produto.
- The system shall oferecer exatamente uma superfície de configuração de
  instância (não duas fluxos redundantes entre popup e opções).
- The system shall manter todos os estados funcionais hoje existentes no
  popup (detecção de instância, envio de aba, progresso, resultado com
  resumo, ações pós-envio) — o redesign não remove capacidade, só
  reestrutura.

### Event-driven

- When o usuário tem um tema definido na instância Voxen conectada, the
  system shall aplicar esse mesmo tema (claro/escuro/variante) na extensão
  assim que a instância for detectada.
- When a extensão ainda não está conectada a nenhuma instância (sem tema
  conhecido), the system shall seguir o esquema claro/escuro do sistema
  operacional do usuário.
- When um job enviado pela extensão falha, the system shall exibir o motivo
  específico do erro (não uma mensagem genérica) — reaproveitando as
  mensagens amigáveis já produzidas pelo backend.

### State-driven

- While o job enviado está em processamento, the system shall indicar em
  qual etapa está (ex.: baixando, transcrevendo, resumindo) quando essa
  informação estiver disponível via status do job — não apenas um rótulo
  genérico "Processando…".

### Unwanted behavior

- If a instância detectada não responder ou a URL for inválida, then the
  system shall explicar o problema em termos que o usuário reconheça (URL
  incorreta, instância offline, etc.) e nunca expor erro técnico cru.

## Critérios de Aceite

- [ ] Popup, opções e `/extensao` usam os tokens de tema do Voxen — trocar
      o tema no app muda a aparência da extensão na próxima abertura.
- [ ] Existe um único fluxo de "conectar instância" (a duplicação entre
      popup e página de opções é eliminada).
- [ ] Todos os estados funcionais existentes (listados no requisito
      ubiquitous acima) continuam presentes e testados manualmente via
      Playwright/carregamento real da extensão.
- [ ] Mensagens de erro/vazio seguem o tom do resto do produto (linguagem
      direta, explica o que fazer a seguir).
- [ ] Estrutura da tela principal do popup comporta, sem redesenhar de
      novo, os novos estados de "conectar plataforma" da spec 121.

## Fora de Escopo

- Captura de cookies em si (spec 121).
- Auto-update da extensão (decisão do usuário — sem isso por ora).
- Mudança de manifesto/permissões além do necessário para os requisitos
  acima (ex.: não adiciona `host_permissions` novos nesta spec).
- Publicação na Chrome Web Store.

## Riscos / Decisões pendentes

- Ordem de implementação: como a spec 121 (cookies) introduz novos estados
  no popup, faz sentido implementar 122 (estrutura/tema) primeiro e 121
  (funcionalidade) depois sobre a estrutura já correta — evita redesenhar
  a mesma tela duas vezes. Confirmar com o usuário se a ordem de PRs deve
  ser 122 → 121 ou se preferem 121 primeiro (cookies é o que motivou a
  conversa original).
- Exploração de paleta/tipografia exata e wireframes de tela ficam para o
  momento da implementação (skill de design), não fazem parte desta spec
  comportamental — aqui só fixamos QUE a extensão deve herdar a identidade
  do produto, não COMO exatamente cada tela fica.

## Decisões tomadas na implementação

- **Superfície única de conexão**: `options.html` foi escolhida como a
  única tela de "conectar instância" (detectar aba aberta / colar URL /
  token opcional). Motivo: o Chromium MV3 não permite abrir o popup
  programaticamente — `background.js` já abre `options.html` no primeiro
  install quando não há `baseUrl` salvo, então essa página já era a
  obrigatória "primeira tela" da extensão. O popup, quando desconectado,
  mostra um estado vazio (texto + botão "Conectar instância") que abre as
  opções via `chrome.runtime.openOptionsPage()`, sem reimplementar o
  formulário de detecção/URL/token.
- **Tema via `GET /api/me`**: a extensão usa o endpoint autenticado
  `/api/me` (cookie de sessão, já reaproveitado pelas outras chamadas via
  `credentials: 'include'`) para ler `user.theme`. Sem sessão válida ou sem
  host permission concedida, cai no fallback por `prefers-color-scheme`.
  Tema resolvido é cacheado em `localStorage` (chave `voxen-ext-theme`) para
  aplicar antes do primeiro paint na próxima abertura (evita flash).
- **Etapa do job**: `GET /api/jobs/:id` já retorna `progressStage` —
  `lib/job-stage.js` espelha os rótulos PT-BR de
  `apps/web/src/client/lib/job-display.ts` (mesmo texto usado na fila do
  app) para consistência de tom entre as duas superfícies.
