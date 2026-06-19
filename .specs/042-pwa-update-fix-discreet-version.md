# 042 — Fix do loop do update PWA + versão discreta na sidebar

## Contexto

Dois ajustes de shell:

1. **Bug**: após um deploy, o toast/botão "nova versão disponível" reaparece várias
   vezes mesmo depois de clicar. Causa: o `onClick` fazia só `window.location.reload()`,
   mas o service worker (vite-plugin-pwa `autoUpdate`) serve o `index.html` precacheado
   (antigo). Após o reload, o `meta voxen-build` continua o antigo → mismatch contra
   `/api/version` persiste → o monitor (`use-version-monitor`) mostra o toast de novo.
2. A informação de versão na sidebar estava num card com borda + ícone — muito proeminente.

## Requisitos

### R1 — Update PWA efetivo

- WHEN o usuário clica em "atualizar" no toast de nova versão THEN o app SHALL forçar o
  service worker a buscar/ativar o build novo (`registration.update()` + skipWaiting) e só
  recarregar quando o SW novo assumir o controle (`controllerchange`), com fallback de
  reload após timeout.
- WHEN o update é aplicado com sucesso THEN o `meta voxen-build` recarregado SHALL bater
  com `/api/version` e o toast NÃO SHALL reaparecer.
- WHEN não há service worker (dev) THEN SHALL cair no reload simples.

### R2 — Versão discreta

- WHEN a sidebar é renderizada THEN a versão SHALL aparecer como uma linha única, pequena
  e muted (sem card/borda/ícone), preservando o tooltip com versão + sha + data de build.

## Fora de escopo

- Trocar a estratégia do PWA (continua `autoUpdate` + monitor de versão server-side).
- Mexer no endpoint `/api/version` ou na injeção do `meta voxen-build`.

## Critérios de aceite

- [ ] Clicar em "atualizar" recarrega no build novo e o toast não volta.
- [ ] Versão na sidebar discreta; tooltip mantém os detalhes.
- [ ] typecheck, lint, prettier, `bun test` e build verdes.
- [ ] Verificação visual/funcional pós-deploy (Easypanel).
