# Spec 084 — Indicador read-only de ambiente em /novidades

## Status

Em implementação (2026-07-12).

## Contexto

A página `/novidades` (changelog) exibia três botões de alternância de "canal" (Todas/Produção/Dev)
acima da listagem, que filtravam o histórico de `releases.json` pelo campo `channel` de cada entrada.
Na prática, esses botões confundiam dois conceitos distintos:

1. O `channel` de CADA ENTRADA do histórico (`dev` ou `prod`), que indica de qual pipeline aquela nota
   veio — isso é metadado de conteúdo, não ambiente de execução.
2. O AMBIENTE REAL em que a instância atual do Voxen está rodando (dev ou produção), que não tinha
   nenhuma representação na UI.

Os botões pareciam (e podiam ser lidos como) um seletor de "ambiente", mas nunca trocavam de
instância: `/novidades` sempre serve o `releases.json` copiado na imagem da instância atual
(`apps/web/src/routes/releases.ts`, não alterado por esta spec) — só filtravam quais entradas do
histórico unificado apareciam na tela. Essa investigação confirmou que a leitura de `releases.json`
está correta; o caso de "changelog vazio em produção" já observado é sintoma de deploy desatualizado
(imagem antiga rodando), não bug de leitura — fora do escopo desta spec.

O runtime já expõe `GET /api/version` (`apps/web/src/index.ts`) com `{ version, gitSha, builtAt }`.
Builds de dev (deploy "source" do Easypanel a partir da branch `dev`) carregam a versão no formato
`X.Y.(Z+1)-dev.<unix_ts>` (`formatDevVersionFromDeploy`); uma release publicada carrega semver limpo
(ex.: `0.11.0`, sem sufixo). Essa é a única fonte de verdade usada por esta spec para distinguir
ambiente.

## Glossário

- **Ambiente**: onde a instância atual está rodando — `dev` (build automática a partir da branch
  `dev`) ou `produção` (release publicada, semver limpo, sem sufixo `-dev.`).
- **Canal da entrada**: campo `channel` de cada item do histórico de `releases.json` (`dev`|`prod`).
  Não é Ambiente e não é alterado por esta spec — continua existindo e sendo exibido por entrada.
- **Indicador de ambiente**: elemento visual read-only, sem interação/clique, que mostra o Ambiente
  atual derivado de `/api/version`.

## Requisitos (EARS)

### Ubiquitous

- O sistema DEVE exibir em `/novidades` a listagem completa (não filtrada) do histórico de releases,
  sem nenhum controle de navegação/filtro manual por canal.
- O sistema DEVE derivar o Ambiente atual exclusivamente a partir do campo `version` retornado por
  `GET /api/version`, usando a presença do marcador `-dev.` como critério.
- O sistema DEVE expor a lógica de derivação do Ambiente como função pura (sem DOM, sem rede, sem
  React), testável isoladamente.

### Event-driven

- Quando `/novidades` carrega e `GET /api/version` responde com uma versão contendo o marcador
  `-dev.`, o sistema DEVE exibir o indicador de Ambiente com o rótulo de Desenvolvimento e uma cor de
  destaque distinta da usada para produção.
- Quando `/novidades` carrega e `GET /api/version` responde com uma versão SEM o marcador `-dev.`
  (semver limpo), o sistema DEVE exibir o indicador de Ambiente com o rótulo de Produção e uma cor de
  destaque distinta da usada para desenvolvimento.

### State-driven

- Enquanto a resposta de `GET /api/version` não tiver chegado, o sistema NÃO DEVE exibir o indicador
  de Ambiente (evita mostrar rótulo incorreto por um instante).

### Unwanted behavior

- Se `GET /api/version` falhar ou retornar uma versão vazia/indefinida, então o sistema NÃO DEVE
  quebrar a renderização da página — apenas omite o indicador de Ambiente.
- Se o usuário procurar uma forma de alternar o histórico exibido por canal (comportamento antigo),
  então o sistema NÃO DEVE oferecer esse controle — a listagem é sempre o histórico completo.

## Critérios de Aceite

- [ ] `/novidades` não exibe mais os botões Todas/Produção/Dev.
- [ ] `/novidades` sempre busca `/api/releases` sem parâmetro `channel` (histórico completo).
- [ ] Um indicador read-only de Ambiente aparece perto do topo da página, sem ser clicável.
- [ ] Versão com marcador `-dev.` → indicador mostra "Desenvolvimento" com destaque âmbar.
- [ ] Versão sem marcador `-dev.` (semver limpo) → indicador mostra "Produção" com destaque
      esmeralda/verde.
- [ ] A função pura de derivação de ambiente tem cobertura de teste para: versão com `-dev.`, versão
      limpa, string vazia e `undefined`.
- [ ] Rótulos do indicador existem em PT-BR e EN.
- [ ] Os badges por entrada do histórico (`channel` de cada item) continuam funcionando como antes —
      não fazem parte desta mudança.

## Fora de Escopo

- Qualquer mudança em `apps/web/src/routes/releases.ts` / `loadReleases()` — já lê `releases.json`
  corretamente; a ausência de changelog em produção observada é sintoma de deploy desatualizado,
  tratado em outra frente pelo owner.
- Qualquer mudança na lógica de cálculo/formatação da versão em `apps/web/src/index.ts`
  (`loadAppVersion`, `formatDevVersionFromDeploy`) — reaproveitada como está.
- Filtro de conteúdo por canal em `/novidades` — removido, não substituído por nenhuma outra forma de
  filtro manual.
- Automação de deploy / atualização automática de produção — tratada em outra frente pelo owner.

## Riscos / Decisões pendentes

- O critério de detecção (`-dev.` no semver) depende do formato produzido por
  `formatDevVersionFromDeploy`. Se esse formato mudar no futuro, a função pura de derivação precisa
  ser atualizada junto.
- O indicador é puramente informativo, por decisão explícita — não deve reintroduzir a confusão de
  "trocar de ambiente pela UI" que motivou a remoção dos botões antigos.
