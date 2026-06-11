# 025 — Ícones de App PWA (maskable sólidos + Apple touch)

## Contexto

O ícone do Voxen instalado como PWA aparece com a logo gigante sobre fundo branco no Android. Causa: os PNGs (`voxen-{192,256,512}.png`) têm fundo transparente e estão declarados no manifest com `purpose: 'any maskable'`. Quando um ícone é maskable, o launcher recorta a safe zone (círculo de ~80% do canvas) e preenche transparência com branco — a logo transparente sem margem é cortada e ganha fundo branco.

A correção segue a recomendação da spec W3C/Maskable.app: ícones `any` e `maskable` devem ser **arquivos separados**, e o maskable precisa de fundo sólido com a logo dentro da safe zone.

## Requisitos (EARS)

- **REQ-1**: O sistema DEVE servir ícones maskable dedicados (`voxen-maskable-512.png` 512x512 e `voxen-maskable-192.png` 192x192) com fundo sólido `#111113`, sem canal alpha, e logo centralizada ocupando ~64% do canvas (dentro da safe zone de 80%).
- **REQ-2**: QUANDO o manifest for gerado pelo vite-plugin-pwa, ENTÃO os ícones transparentes existentes DEVEM ter `purpose: 'any'` e os novos ícones sólidos DEVEM ter `purpose: 'maskable'` — nunca `'any maskable'` no mesmo arquivo.
- **REQ-3**: O manifest DEVE declarar `id: '/'` para identidade estável do app instalado.
- **REQ-4**: O manifest DEVE conter `shortcuts` apenas para rotas existentes no router (`/chat`, `/transcricoes`, `/jobs`, `/grafo`).
- **REQ-5**: O sistema DEVE servir `apple-touch-icon.png` 180x180 com fundo sólido `#111113`, sem canal alpha e cantos retos (iOS aplica o arredondamento), referenciado em `index.html` via `<link rel="apple-touch-icon">`.
- **REQ-6**: O `index.html` DEVE declarar `theme-color` `#111113` e as metas iOS (`apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style` black-translucent, `apple-mobile-web-app-title` Voxen).

## Critérios de Aceite

- [ ] `dist/manifest.webmanifest` pós-build contém ícones com purposes `any` e `maskable` em entradas separadas e `id: '/'`.
- [ ] `magick identify` confirma: maskable 512/192 e apple-touch 180 em sRGB sem alpha.
- [ ] Shortcuts do manifest apontam somente para rotas registradas em `App.tsx`.
- [ ] Lint, typecheck e build do `@voxen/web` verdes.

## Fora de Escopo

- Splash screens iOS (`apple-touch-startup-image`).
- Regeneração dos favicons existentes.
