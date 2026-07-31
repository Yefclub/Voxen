# 121 — Captura de cookies de plataforma via extensão

## Contexto

O worker do Voxen já suporta cookies autenticados (formato Netscape) pra
extrair conteúdo de plataformas que bloqueiam download anônimo — TikTok,
Instagram, YouTube em casos de idade/restrição. Hoje esse valor vive na
setting global cifrada `yt_dlp_cookies` (`apps/web/src/lib/settings.ts`),
mas **não existe nenhuma rota web que a grave** — só é lida pelo worker
Python (`voxen_settings.get_yt_dlp_cookies`). O único jeito de configurar
hoje seria escrita manual no banco, o que não é um fluxo real de produto.

O fluxo manual de obter esse cookie (abrir devtools, exportar via extensão
de terceiro tipo "Get cookies.txt", colar em algum lugar) é a barreira real
— não a ausência de suporte a cookies em si.

A extensão Voxen já existe (Chromium MV3, sideload, `apps/extension/`,
spec 106) e já se autentica na própria instância reaproveitando a sessão do
browser (`credentials: 'include'`). Esta spec estende essa extensão pra
capturar os cookies de sessão de uma plataforma de conteúdo (não da própria
instância Voxen) no momento em que o usuário loga nela normalmente, e enviar
esse cookie pro backend do Voxen — substituindo o fluxo manual.

Este é um recurso de **configuração de infraestrutura do operador**, não de
conteúdo por workspace — segue o mesmo padrão de `yt_dlp_proxy_urls` e
`proxy_agent_token`: setting GLOBAL, escrita restrita a ADMIN.

## Glossário

- **Plataforma suportada**: TikTok, Instagram ou YouTube — os três domínios
  cobertos nesta spec.
- **Captura de cookies**: leitura dos cookies do browser para o domínio da
  plataforma suportada, via API de extensão, após login normal do usuário
  naquele domínio.
- **Conectar plataforma**: ação do usuário na extensão que dispara a
  captura e o envio ao backend.

## Requisitos

### Ubiquitous

- The system shall armazenar o cookie capturado cifrado em repouso, na
  mesma tabela `Setting` (scope GLOBAL) já usada por `yt_dlp_cookies`.
- The system shall restringir a escrita do cookie capturado a usuários com
  role ADMIN.
- The system shall nunca registrar o valor do cookie capturado em log,
  resposta de API, ou qualquer diagnóstico — mesmo mascarado.
- The system shall registrar a data/hora da última captura bem-sucedida por
  plataforma, para permitir aviso de expiração.

### Event-driven

- When o usuário clica em "Conectar" para uma plataforma suportada na
  extensão, the system shall solicitar (se ainda não concedida) a permissão
  de host específica daquele domínio antes de prosseguir.
- When a permissão de host é concedida e o usuário está autenticado
  naquele domínio (cookies de sessão presentes), the system shall capturar
  os cookies relevantes e enviá-los cifrados ao backend do Voxen associado
  à instância configurada na extensão.
- When o backend recebe uma captura de cookie válida de um ADMIN
  autenticado, the system shall persistir o valor cifrado e a data de
  captura, sobrescrevendo qualquer valor anterior daquela plataforma.
- When o usuário não está logado na plataforma no momento da captura (sem
  cookies de sessão relevantes presentes), the system shall informar que
  nenhuma sessão foi encontrada e não enviar nada ao backend.
- When se passam mais de 7 dias desde a última captura bem-sucedida de uma
  plataforma, the system shall sinalizar essa plataforma como "possivelmente
  expirada" na UI da extensão e nas integrações admin do Voxen.

### State-driven

- While o usuário autenticado na extensão não tem role ADMIN na instância
  Voxen configurada, the system shall ocultar a ação de conectar plataforma
  (não apenas desabilitar).

### Unwanted behavior

- If a chamada de captura falhar (rede, permissão negada, backend
  indisponível), then the system shall informar o erro na UI da extensão
  sem apagar ou sobrescrever o cookie já armazenado no backend.
- If o usuário revoga a permissão de host de uma plataforma após já ter
  conectado, then the system shall continuar operando com o último cookie
  válido já enviado (revogação de permissão da extensão não afeta o valor
  já persistido no backend — só bloqueia capturas futuras até reconceder).

## Critérios de Aceite

- [ ] Extensão: botão "Conectar" por plataforma suportada (TikTok,
      Instagram, YouTube), com pedido de permissão de host on-demand
      (`optional_host_permissions` por domínio, não `<all_urls>` amplo).
- [ ] Extensão: captura via `chrome.cookies.getAll` no domínio da
      plataforma, serializa em formato Netscape (mesmo formato já esperado
      pelo worker).
- [ ] Backend: rota `PATCH /api/admin/integrations/cookies` (ou
      equivalente), admin-gated, aceita `{ platform, cookies }`, grava
      cifrado, registra timestamp de captura por plataforma.
- [ ] Backend: rota de leitura de status (sem retornar o valor cru) —
      `{ platform, hasCookie, capturedAt, stale }` por plataforma, pra UI
      da extensão e da página de integrações do Voxen mostrarem estado.
- [ ] UI admin do Voxen (`admin-integracoes.tsx`): mostra estado de cada
      plataforma (conectado/não conectado/possivelmente expirado) —
      complementa a extensão, não duplica a captura em si.
- [ ] Testes: rota admin rejeita não-ADMIN; captura nunca aparece em log;
      TTL de 7 dias sinaliza `stale: true` corretamente.
- [ ] Nenhuma mudança na spec/arquitetura de `yt_dlp_proxy_urls` ou
      `proxy_agent_token`.

## Fora de Escopo

- Redesign visual da extensão (spec 122).
- Auto-update da extensão (decisão do usuário: sem auto-update por ora).
- Login OAuth "de verdade" — isso não existe pras plataformas cobertas
  (TikTok/Instagram/YouTube não expõem OAuth que substitua cookie de sessão
  pra scraping). O fluxo é captura de cookie pós-login manual, não OAuth.
- Suporte a outras plataformas além de TikTok/Instagram/YouTube nesta
  primeira entrega.
- Renovação automática do cookie sem intervenção do usuário — expira,
  sinaliza, usuário reconecta manualmente.

## Riscos / Decisões pendentes

- **Escopo do cookie por-usuário vs. GLOBAL**: esta spec assume GLOBAL
  (1 cookie por plataforma pra toda a instância), consistente com
  `yt_dlp_cookies`/`yt_dlp_proxy_urls`/`proxy_agent_token` já existentes.
  Se a instância tiver múltiplos usuários aprovados que queiram usar contas
  diferentes da mesma plataforma, isso não é suportado — precisaria virar
  setting por-usuário, mudança maior de escopo. Assumindo GLOBAL até
  indicação em contrário, já que o padrão de uso real do Voxen é
  single-tenant com poucos usuários confiáveis.
- **Formato de serialização**: usar Netscape cookie format (mesmo que o
  worker já consome) é a opção de menor atrito — sem mudar
  `voxen_settings.py`/`ytdl.py`. Confirmar que `chrome.cookies.getAll`
  retorna todos os campos necessários (domain, path, secure, expirationDate,
  httpOnly) pra montar o formato corretamente.

## Decisões tomadas na implementação

Registradas aqui porque fecham os pontos que a spec deixou em aberto.

### D1 — Três plataformas dentro da mesma setting `yt_dlp_cookies`

O worker lê **uma** setting (`voxen_settings.get_yt_dlp_cookies` →
`ytdl._cookiefile_opts`) e materializa o conteúdo inteiro num único
`cookiefile` do yt-dlp. O yt-dlp filtra por domínio sozinho na hora da
requisição, então **um único arquivo Netscape concatenado com os cookies das
três plataformas funciona** sem tocar em nada do worker.

Consequência: escrever a captura de uma plataforma é um **merge por domínio**
sobre o arquivo existente, não um overwrite do arquivo inteiro:

1. as linhas cujo domínio pertence à plataforma que está sendo gravada são
   removidas (é o "sobrescrevendo qualquer valor anterior daquela
   plataforma" do requisito);
2. as demais linhas são preservadas **verbatim** — inclusive linhas de
   domínios fora das três plataformas, que um operador possa ter colado
   manualmente no `yt_dlp_cookies` antes desta feature;
3. o bloco novo é anexado ao fim.

Não foi criada chave nova pro valor do cookie: duplicar o segredo em duas
settings cifradas seria mais superfície pra vazar sem ganho nenhum.

A rota admin desta spec é também a primeira implementação de escrita da
setting `yt_dlp_cookies` — a spec 063 definiu o secret e o consumo no worker,
mas o endpoint previsto lá nunca foi construído.

### D2 — Timestamp de captura em chave separada, não no valor

O timestamp por plataforma vive em `platform_cookies_meta` — chave GLOBAL
nova, cifrada como todas as outras, com JSON
`{"<plataforma>": {"capturedAt": "<ISO 8601>"}}`.

Não foi embutido no payload de `yt_dlp_cookies` porque o formato daquele
valor é contrato com o yt-dlp: qualquer envelope (JSON, cabeçalho extra)
exigiria mudar `voxen_settings.py`/`ytdl.py` e quebraria um
`yt_dlp_cookies` já configurado manualmente. Comentário Netscape (`# ...`)
foi descartado pelo mesmo motivo de fragilidade — o merge por domínio teria
de preservar/reescrever comentários posicionalmente.

`hasCookie` é derivado do conteúdo real de `yt_dlp_cookies` (existe alguma
linha do domínio daquela plataforma?), não do metadado — assim um cookie
colado manualmente antes desta feature aparece como conectado. Quando há
cookie mas não há `capturedAt` (esse caso legado), a resposta traz
`capturedAt: null` e `stale: false`: sem data conhecida não dá pra afirmar
que expirou, e alarme falso é pior que silêncio.

### D3 — Servidor revalida o arquivo Netscape recebido

A extensão serializa e o backend **revalida linha a linha** antes de
persistir: exatamente 7 campos separados por TAB, `expires` só dígitos,
flags `TRUE`/`FALSE`, e domínio pertencente à plataforma declarada no corpo
da requisição. Linhas fora do domínio da plataforma são **rejeitadas** (422),
não ignoradas — impede que um cliente adulterado enfie cookie de qualquer
site na setting global usando a rota "do TikTok".

Motivo principal: **cliente adulterado**. A rota é a única barreira entre um
POST arbitrário e a setting global — sem revalidação, `platform: 'tiktok'`
gravaria cookie de qualquer domínio.

Além disso, a robustez do arquivo depende desta validação — mas de forma
**assimétrica**, e essa assimetria já foi documentada errado duas vezes.
Comportamento medido no container do worker (yt-dlp 2026.07.04, Python
3.13.14, `ignore_discard=True` para isolar o confundidor de session-cookie):

| linha ruim | `YoutubeDLCookieJar` (worker) | `MozillaCookieJar` (stdlib) |
| --- | --- | --- |
| campos ≠ 7 | pula a linha + warning | aborta tudo |
| `expires` com sinal / notação-e | pula a linha + warning | carrega |
| `expires` fracionário (`1.5`) | **aceita** | carrega |
| flag fora de `TRUE`/`FALSE` | **ABORTA O ARQUIVO INTEIRO** | aborta tudo |

Mecanismo (`yt_dlp/cookies.py`): o `except LoadError → warning → continue`
cobre **somente** o que o `prepare_line` checa — contagem de campos e o
regex `[0-9]+(?:\.[0-9]+)?` de `expires`. Todo o resto cai no
`_really_load` **fora** do try, e ali o `LoadError` propaga.

Consequência: **as checagens de flag são load-bearing** — sem elas, uma
captura ruim derruba a autenticação de todas as plataformas. As de
contagem/expiração evitam perda silenciosa daquela linha.

> Histórico das premissas erradas (não repita nenhuma das duas):
> 1. A versão original dizia que o `prepare_line` derruba o arquivo inteiro
>    na primeira linha malformada. Falso — ele pula contagem de campos e
>    expiração inválida.
> 2. A primeira correção inverteu para "o yt-dlp nunca derruba o arquivo;
>    quem aborta é o `MozillaCookieJar` da stdlib, que não é o parser do
>    worker". Também falso, duas vezes: o yt-dlp **aborta sim** com flag
>    inválida, e `YoutubeDLCookieJar` **é** subclasse de `MozillaCookieJar`
>    (`YoutubeDLCookieJar._really_load is MozillaCookieJar._really_load`
>    → `True`) — não são dois parsers, é o mesmo por herança.

### D4 — YouTube captura só `.youtube.com`

A captura do YouTube ignora `google.com`. Cookies de conta Google cobrem
Gmail/Drive/etc.; arrastar tudo isso pra dentro de uma setting do Voxen é
uma ampliação de blast radius sem retorno — o yt-dlp opera com os cookies de
`youtube.com` no caso de uso desta spec (vídeo restrito por idade / bloqueio
anti-bot). Se um caso concreto exigir os cookies do domínio Google, vira
decisão explícita em outra spec.

### D5 — Prefixo `#HttpOnly_` não é emitido

A flag `httpOnly` não tem efeito no uso que o yt-dlp faz do arquivo, e a
linha sem prefixo é aceita por todos os parsers envolvidos. Como não há
ganho, não emitimos o prefixo — menos variação no formato, menos
superfície de incompatibilidade.

> Correção (review da PR #499): uma versão anterior deste texto justificava
> a decisão dizendo que o `MozillaCookieJar` da stdlib trataria a linha
> prefixada como comentário e descartaria o cookie. **Isso é falso** — a
> stdlib do Python suporta `#HttpOnly_` explicitamente
> (`http/cookiejar.py`, constante `HTTPONLY_PREFIX`), verificado nos dois
> parsers. A decisão de não emitir segue válida pelo motivo acima; a
> premissa original, não.

### D6 — `DELETE` de plataforma (adicionado ao escopo)

A spec previa só gravar e ler. Ficou uma rota
`DELETE /api/admin/integrations/cookies/:platform` que remove as linhas
daquela plataforma e o timestamp correspondente. Guardar credencial de
sessão de uma conta real sem um caminho de revogação na própria UI é falha
de segurança, não economia de escopo.
