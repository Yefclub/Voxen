# Spec 106 — Extensão de browser Chromium (sideload)

## Contexto

Usuários self-hosted precisam capturar URLs da aba atual sem copiar/colar no
dashboard. A API `POST /api/jobs/auto` já existe; falta um client MV3 + página de
download na UI.

## Requisitos

### Ubiquitous

- The system shall disponibilizar uma extensão Manifest V3 em
  `apps/extension/` empacotável como ZIP em `apps/web/public/extension/`.
- The system shall expor a página autenticada `/extensao` com instruções PT-BR/EN
  e link de download do ZIP.
- The extension shall permitir configurar a URL base da instância nas opções.
- The extension shall enviar a URL da aba ativa via `POST {base}/api/jobs/auto`
  com corpo `{ "url": "<tab url>" }` e `credentials: "include"`.

### Event-driven

- When a extensão for instalada sem URL base, the system shall abrir a página de
  opções.
- When o envio retornar 401, the extension shall oferecer abrir
  `{base}/entrar?next=/fila`.
- When o envio retornar 201 (ou 409 com jobId), the extension shall mostrar o
  `jobId` e link opcional para `/jobs/:id`.

### Optional

- Where o usuário informar token nas opções, the extension shall enviar
  `Authorization: Bearer <token>` (reservado; jobs usam sessão no MVP).

### Unwanted behavior

- If a aba não for `http(s)`, then the extension shall desabilitar o envio.
- If a URL base for inválida, then the extension shall recusar salvar.
- If a permissão de host for negada, then the extension shall reportar erro
  claro (sem falhar silenciosamente).

## Critérios de Aceite

- [ ] Extensão carrega no Chrome sem erros de manifest.
- [ ] Popup mostra título + URL da aba e botão “Enviar para o Voxen”.
- [ ] Página `/extensao` na navegação com download do ZIP.
- [ ] Strings de UI em PT-BR e EN.
- [ ] Testes unitários dos helpers de URL/API.
- [ ] Entrada em `changelog/unreleased/`.
