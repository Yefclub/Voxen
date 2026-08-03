# Spec 131 — PWA mobile UX: toasts, update silencioso, notificações L1, auto-open

## Contexto

No uso mobile do PWA, quatro fricções se acumulam: toasts in-app envelhecem com a aba
em segundo plano e reaparecem como se fossem novos; o modal de atualização exige
confirmação a cada deploy; jobs que terminam em background só viram toast (quando a
aba volta); a tela do job não abre a transcrição ao concluir.

Web Push (app morto) e share “silencioso” ficam de fora desta spec.

## Requisitos

### Event-driven

- When the document becomes visible again, the system shall discard in-app toasts whose
  wall-clock age already exceeds the configured toast duration and shall not present those
  items as a fresh multi-second toast.
- When a newer application build is detected and chat streaming is not active, the system
  shall apply the update and reload without requiring the update modal.
- When a job reaches a terminal stage `done` or `failed` while the document is hidden and
  notification permission is granted, the system shall show a system notification with the
  Voxen identity (title/body/icon) instead of only enqueueing an in-app toast.
- When a job reaches `done` with a transcript id, the document is visible, and the user is
  on that job’s detail route, the system shall navigate to the transcript detail route.

### State-driven

- While chat streaming is active, the system shall not apply a detected version update.
- While the document is visible, terminal job feedback for done/failed shall use in-app
  toast (not system notification), unless auto-open navigation already covers the success
  case on the focused job detail page.

### Unwanted behavior

- If notification permission is denied or unsupported, the system shall not crash and shall
  skip system notifications.
- If multiple jobs complete while the user is not on a given job’s detail page, the system
  shall not mass-navigate between transcripts.

## Critérios de Aceite

- [ ] Toasts stale/hidden não reaparecem como fila “fresca” de 5s
- [ ] Update aplica sozinho quando !streaming; modal não bloqueia o open
- [ ] Notificação de sistema no DONE/FAILED com documento hidden + permission granted
- [ ] Auto-navigate `/transcricoes/:id` no DONE na página do job focado e visível
- [ ] Testes unitários nos helpers/módulos enviados

## Fora de Escopo

- Share-target quiet / não abrir o PWA
- Web Push / VAPID
- Auto-open de todo job concorrente em qualquer rota
