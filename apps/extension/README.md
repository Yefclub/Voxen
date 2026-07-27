# Extensão Voxen (Chromium MV3)

## v0.2

- UI redesenhada (popup + options)
- Detectar instância aberta no browser
- Acompanhar job em background + notificação com resumo
- Checagem de update via `/extension/version.json`
- Badge enquanto processa / quando há update

## Instalar (sideload)

1. Baixe o ZIP em `/extensao` (ou rode `./package.sh`)
2. `chrome://extensions` → Modo do desenvolvedor → Carregar sem compactação
3. Opções → **Detectar instância** (com o Voxen aberto) ou cole a URL
4. Login no Voxen no mesmo perfil

## Empacotar

```bash
./apps/extension/package.sh
```

Gera `apps/web/public/extension/voxen-extension.zip`.

## Limitações do auto-update

Chrome **não** atualiza “Load unpacked” sozinho. A extensão consulta a
instância e avisa (badge ↑ + notificação). O usuário recarrega o ZIP/pasta.
Chrome Web Store permitiria update silencioso no futuro.
