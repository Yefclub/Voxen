# Spec 092 — Âncora de scroll ao enviar mensagem

## Contexto

No chat atual, cada envio gruda a viewport no fundo (`stick-to-bottom`). Isso comprime a mensagem do usuário e o início da resposta no rodapé. O Orbital (e ChatGPT) ancoram a mensagem recém-enviada perto do topo, reservando espaço abaixo para a resposta nascer com calma. Esta spec porta esse comportamento para o Voxen.

Referência: `Orbital/frontend/src/components/chat/chat-scroll.ts`.

## Glossário

- **Âncora**: posicionar a mensagem do usuário no topo do viewport do scroller (com gap pequeno).
- **Espaçador**: bloco vazio no fim da lista que torna a âncora rolável; encolhe enquanto a resposta cresce.
- **Fase `anchor`**: follow automático desligado até o conteúdo se aproximar do fim do viewport ou o usuário rolar.
- **Fase `free`**: comportamento legado (seguir o fundo quando perto do bottom).

## Requisitos

### Ubiquitous

- The system shall keep scroll decision logic in a pure module (`chat-scroll.ts`) without DOM APIs, unit-tested.
- The system shall keep the composer outside the scroller (current layout); the visible band for anchoring is the scroller viewport itself.

### Event-driven

- When the user sends a new message, the system shall anchor that user message near the top of the scroller (gap ~12px) after the bubble mounts, using a spacer if needed.
- When the assistant response grows during an anchored turn, the system shall shrink the spacer so the anchored message does not jump.
- When the real content approaches the bottom of the scroller (~3% of viewport, min 24px), the system shall re-engage stick-to-bottom follow.
- When the user scrolls up during an anchored turn, the system shall exit anchor phase and stop auto-follow until they return near the bottom.

### Unwanted behavior

- If the user message is taller than ~70% of the visible band, then the system shall fall back to legacy scroll-to-bottom (do not anchor).
- If the user bubble is not in the DOM after a few animation frames, then the system shall fall back to scroll-to-bottom.
- If the conversation is empty (greeting + centered composer), then the system shall not apply anchoring.

## Critérios de Aceite

- [ ] Pure helpers (`planAnchor`, `nextSpacerHeight`, `shouldAnchor`, `shouldReengageFollow`, etc.) have unit tests.
- [ ] Sending a message in a non-empty conversation pins the new user bubble near the top with space below.
- [ ] Streaming growth does not jump the anchored message.
- [ ] Manual scroll-up cancels follow; “Ir ao mais recente” still works in free phase.
- [ ] Initial load of an existing conversation still opens at the bottom (unchanged).

## Fora de Escopo

- Overlay/sticky composer inside the scroller (Orbital-only layout detail).
- Anchoring on edit/regenerate (Voxen has no edit/regenerate yet).
- Playwright visual tests (owner constraint unless asked).

## Riscos / Decisões

- Composer height is treated as `0` for band math because it sits outside the scroller in Voxen.
