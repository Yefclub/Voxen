# Extensão Voxen (Chromium MV3)

## v0.4

- **Contas de plataforma** (spec 121): em `options.html`, um botão "Conectar"
  por plataforma (TikTok, Instagram, YouTube) captura a sessão daquele site e
  a envia para a instância, que a guarda cifrada e a entrega ao yt-dlp. É o
  que destrava conteúdo que só baixa com login.
  - A seção só aparece quando a instância conectada responde que o usuário
    logado é `ADMIN` — a rota de escrita é admin-only.
  - Permissões **on-demand**: a permissão `cookies` e a host permission do
    domínio (`https://*.tiktok.com/*` etc.) são pedidas no clique, uma
    plataforma por vez. Nada de `<all_urls>`, nada concedido por padrão.
    "Desconectar" devolve a host permission daquele site.
  - O valor do cookie existe só como variável local entre o
    `chrome.cookies.getAll` e o `PATCH` — nunca vai pra `chrome.storage`, pra
    tela ou pro console.
  - Sem cookie de sessão do site, a extensão avisa "nenhuma sessão
    encontrada" e não envia nada.

## v0.3

- Identidade visual herdada do Voxen web: mesmos tokens de cor (`--color-app-*`,
  `--color-accent-*`) e tipografia (Bricolage Grotesque + Inter + JetBrains
  Mono) de `apps/web/src/client/index.css` — nada de paleta própria.
- Tema segue a instância conectada (`GET /api/me`, campo `theme`) quando há
  sessão; sem instância conectada, segue o esquema claro/escuro do SO.
- **Superfície única de conexão**: `options.html` é a única tela onde a
  extensão se conecta a uma instância Voxen (detectar aba aberta / colar
  URL / token opcional). O popup não reimplementa esse formulário — quando
  não há instância conectada, mostra um estado vazio com um botão que abre
  as opções. Isso evita duas implementações divergentes do mesmo fluxo
  (era o caso até a v0.2).
- Progresso do job mostra a etapa real (baixando, transcrevendo, resumindo…)
  quando disponível via `progressStage` do status do job.
- **Estado do envio sobrevive ao fechar o popup**: no MV3 o documento do popup
  é destruído ao perder o foco, então quem lembra do job é o service worker
  (`chrome.storage.local`: `trackedJobs` para o que está em andamento e
  `lastJobOutcome` para o desfecho ainda não visto). Ao reabrir, o popup
  restaura progresso ou resultado — ver `lib/job-state.js` (lógica pura,
  coberta por `tests/job-state.test.js`). O rastreamento tem TTL
  (`TRACKED_JOB_TTL_MS`): job que nunca resolve é descartado em vez de ficar
  eterno no storage. E acompanhamento indisponível (instância fora do ar) não
  desabilita o envio — estado desconhecido não é ocupação.
- **Escritas de estado são serializadas**: `trackJob`, `pollTrackedJobs` e
  `settleJob` são `async` e se intercalam nos `await`, então "só o service
  worker escreve" não basta para evitar read-modify-write perdido. Todas as
  escritas de `trackedJobs`/`lastJobOutcome` passam por `withStorageLock` em
  `background.js`, com a fase de rede deliberadamente fora do lock.
- Acompanhar job em background + notificação com resumo
- Checagem de update via `/extension/version.json`
- Badge enquanto processa / quando há update

## Instalar (sideload)

1. Baixe o ZIP em `/extensao` (ou rode `./package.sh`)
2. `chrome://extensions` → Modo do desenvolvedor → Carregar sem compactação
3. Clique no ícone da extensão → **Conectar instância** (abre as opções) →
   **Detectar instância** (com o Voxen aberto) ou cole a URL
4. Login no Voxen no mesmo perfil

## Empacotar

```bash
./apps/extension/package.sh
```

Gera `apps/web/public/extension/voxen-extension.zip`.

## Ícones

`icons/icon-{16,48,128}.png` são gerados de `apps/web/public/voxen-512.png`:

```bash
python3 apps/extension/tools/generate-icons.py   # requer Pillow
```

O script recorta o padding transparente da arte, escala com LANCZOS
preservando a proporção e centraliza no canvas. A arte é retrato (~0.62 de
proporção), então a altura é o limite: ela ocupa 100% da altura e sobra
padding lateral simétrico. Ícone mais "largo" em 16 px exigiria recortar ou
distorcer a arte — seria decisão de design, não de enquadramento.

## Limitações do auto-update

Chrome **não** atualiza “Load unpacked” sozinho. A extensão consulta a
instância e avisa (badge ↑ + notificação). O usuário recarrega o ZIP/pasta.
Chrome Web Store permitiria update silencioso no futuro.
