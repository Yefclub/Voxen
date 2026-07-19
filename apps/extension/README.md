# Voxen Browser Extension (Chromium MV3)

Extensão sideload para Chrome/Edge/Brave: envia a URL da aba atual para
`POST {APP_BASE_URL}/api/jobs/auto`.

## Desenvolvimento

1. Empacote (gera zip + unpacked em `apps/web/public/extension/`):

   ```bash
   bash apps/extension/package.sh
   ```

2. Chrome → `chrome://extensions` → Modo do desenvolvedor → **Carregar sem compactação**
   → selecione `apps/extension/` (ou `apps/web/public/extension/unpacked/`).

3. Abra **Opções**, configure a URL base (ex.: `http://localhost:3000`), autorize o host
   e faça login na instância no mesmo perfil do browser.

## Auth (MVP)

- Preferência: cookies da sessão better-auth com `credentials: 'include'` +
  `optional_host_permissions` para a origem da instância.
- Token Bearer opcional no storage (campo nas opções) — o endpoint de jobs hoje
  autentica por sessão; o header fica reservado.
- 401 → botão “Fazer login” abre `{base}/entrar?next=/fila`.

## Testes

```bash
cd apps/web && bun test ../extension/tests
```
