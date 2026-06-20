# 054 — Uniformização de altura dos cards da Biblioteca

## Contexto

Na página **Biblioteca** (`apps/web/src/client/pages/transcricoes.tsx`), os cards de
transcrição exibem um preview/thumbnail (`thumbnailUrl` ou `/api/transcripts/:id/preview`).
Quando a imagem é **vertical** (ex.: print de tela, Reels/TikTok), o container do preview
não tem proporção fixa em todos os breakpoints, fazendo o card ficar mais alto que os demais
e quebrando o alinhamento do grid — especialmente no **mobile**, onde o card é uma linha
horizontal com o preview em `h-auto w-28` (sem altura definida, a imagem assume tamanho
natural e estica a linha).

No desktop o preview já usa `sm:aspect-video`, mas o mobile não tinha proporção fixa.

## Objetivo

Garantir que **todos os cards do grid tenham a mesma altura**, com o preview recortado
(`object-cover`) dentro de um container com proporção fixa, em ambos os layouts
(mobile = linha horizontal; desktop = coluna).

## Requisitos (EARS)

- **R1** — When o card é renderizado no layout mobile (linha horizontal), the system shall
  exibir o preview num container de proporção fixa (largura `w-28` + `aspect-square`),
  com `object-cover` e `overflow-hidden`, de modo que imagens verticais sejam recortadas
  sem alterar a altura da linha.
- **R2** — When o card é renderizado no layout desktop (coluna), the system shall manter o
  preview em `aspect-video` (16:9) com `object-cover` e `overflow-hidden`.
- **R3** — While qualquer card do grid está visível, the system shall manter todos os cards
  com a mesma altura (preview com proporção fixa + corpo de texto com slots de altura
  consistentes e truncamento via `line-clamp`).
- **R4** — When a transcrição não possui thumbnail próprio, the system shall renderizar o
  preview (placeholder/endpoint de preview) respeitando a mesma proporção fixa, sem
  exceções de altura.
- **R5** — The system shall não alterar a lógica de fetch, filtros ou navegação dos cards —
  somente a apresentação visual.

## Fora de escopo

- Mudanças na geração do preview no backend.
- Alteração de cores/tema (mantém zinc + acento violeta existentes).

## Validação

- Sem Playwright no projeto: validação visual manual obrigatória pelo owner em mobile e
  desktop, com transcrições de thumbnail vertical e horizontal misturadas no mesmo grid.
