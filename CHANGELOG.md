# Changelog

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
