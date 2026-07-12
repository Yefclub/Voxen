# Spec 073 — Chat UX profissional, temas e reestruturação home/biblioteca/fila

## Status

Aprovado pelo owner (2026-07-12) — decisões fechadas na conversa.

## Contexto

A página `/chat` atual (sessão única, spec 071) funciona, mas o visual está frágil: header verboso, composer que “escapa” da viewport, cards de ferramenta pesados e empty state desalinhado do padrão SuperGrok. Em paralelo, o produto ainda não tem sistema de temas: o CSS fixa dark com viés verde.

Esta spec cobre:
1. Redesign do chat (composer, empty state, reasoning, toolblock) alinhado ao mockup `tool-sim.html` e ao print SuperGrok.
2. Limpar conversa canônica com confirmação irreversível.
3. Shell: desktop `/` = chat; mobile `/` = home enxuta; ingest na Biblioteca; página dedicada “Sua fila”.
4. Sistema robusto de temas (`zinc` padrão, `emerald`, `light`) persistido no usuário, seletor no menu e toggle claro/escuro no cabeçalho.
5. Streaming de reasoning no runtime web (TS), não no serviço Python removido.

Referências: `.specs/053-chat-home-minimal.md`, `.specs/068-home-content-ingest.md`, `.specs/071-chat-single-session.md`, `.specs/072-home-library-selection.md`. Spec 052 (reasoning no Python) fica obsoleta para o runtime atual.

## Glossário

- **Tema**: pacote de tokens CSS (`--color-app-*`, acentos, `color-scheme`) aplicado por um id (`zinc` | `emerald` | `light`).
- **Conversa canônica**: única conversa persistida por usuário (spec 071).
- **Ingest**: envio de URL ou arquivo para criar job de processamento.
- **Fila**: listagem paginada de jobs do usuário (“Sua fila”).
- **Reasoning**: trechos de cadeia de pensamento emitidos pelo provedor durante o stream; exibidos colapsáveis na UI, sem vazar como resposta final.

## Requisitos

### Ubiquitous

- The system shall definir todas as cores de superfície, texto, borda e acento via tokens CSS compartilhados selecionados pelo tema ativo.
- The system shall oferecer os temas `zinc` (padrão), `emerald` e `light`.
- The system shall persistir o tema escolhido no registro do usuário no banco de dados.
- The system shall manter exatamente uma conversa canônica por usuário; limpar conversa remove mensagens e aprovações pendentes dessa conversa, sem criar outra sessão.
- The system shall renderizar reasoning e eventos de ferramenta com visual discreto (header fino, colapsável, timeline) alinhado ao mockup de ferramentas.
- The system shall manter o composer fixo na área inferior do painel de chat (scroll apenas no histórico), sem “cair” abaixo da viewport.

### Event-driven

- When um usuário autenticado acessa `/` em viewport desktop (`md+`), the system shall apresentar a página de chat (equivalente a `/chat`).
- When um usuário autenticado acessa `/` em viewport mobile (`< md`), the system shall apresentar a home enxuta (saudação/resumo), sem o card de ingest e sem a seção de fila.
- When o usuário usa ingest (URL ou arquivo), the system shall fazê-lo a partir da página Biblioteca (`/transcricoes`).
- When o usuário abre “Sua fila”, the system shall apresentar a listagem de jobs em rota dedicada (`/fila`).
- When o usuário entra em `/chat` (ou `/` desktop), the system shall forçar a sidebar colapsada somente enquanto permanecer nessa rota, sem sobrescrever a preferência global de sidebar ao sair.
- When o usuário clica em limpar conversa e confirma no diálogo destrutivo, the system shall apagar o histórico da conversa canônica de forma irreversível e exibir empty state.
- When o provedor emitir deltas de reasoning durante o stream, the system shall transmitir eventos SSE `reasoning` e a UI shall exibi-los em bloco colapsável (“Pensando” / duração).
- When o usuário seleciona um tema no menu do avatar, the system shall aplicar os tokens imediatamente e persistir no DB.
- When o usuário aciona o toggle claro/escuro no cabeçalho, the system shall alternar entre `light` e o último tema escuro usado (`zinc` ou `emerald`) e persistir.

### State-driven

- While a conversa está vazia, the system shall exibir no centro apenas texto de boas-vindas com o nome do usuário e o composer (estilo SuperGrok), sem o título “Conversar com Vox” nem subtítulo descritivo.
- While uma resposta está em streaming, the system shall manter botão de interromper e não deslocar o foco do composer.
- While o tema `light` está ativo, the system shall usar `color-scheme: light` e tokens claros; while `zinc` ou `emerald` estão ativos, the system shall usar `color-scheme: dark`.

### Optional

- Where sons do chat estão habilitados, the system shall manter o toggle de sons no cabeçalho da página de chat (junto ao limpar conversa).

### Unwanted behavior

- If o usuário cancela o diálogo de limpar conversa, then the system shall não alterar mensagens.
- If uma requisição de limpar conversa vier sem autenticação ou de outro usuário, then the system shall rejeitar sem efeito.
- If o stream falhar no meio do reasoning, then the system shall preservar o texto de reasoning já recebido no turno e emitir erro recuperável sem corromper a conversa.
- If o valor de tema no DB for inválido ou ausente, then the system shall aplicar `zinc`.

## Critérios de Aceite

- [ ] Desktop: `/` mostra chat; mobile: `/` mostra home enxuta.
- [ ] Ingest (link + arquivo + DnD) vive na Biblioteca; `/fila` lista a fila de jobs.
- [ ] Empty state do chat: boas-vindas com nome + composer central; sem “Conversar com Vox…”.
- [ ] Composer não escapa da viewport; sons e limpar ficam no header do chat.
- [ ] Limpar conversa exige confirmação explícita de irreversibilidade e apaga o histórico.
- [ ] Toolblock + reasoning seguem o visual do mockup; reasoning chega via SSE.
- [ ] Temas `zinc` (default), `emerald`, `light` aplicados via tokens; seletor no menu do user; toggle claro/escuro no topbar.
- [ ] Preferência de tema persistida em `User` (DB) e refletida em `/api/me`.
- [ ] Sidebar colapsada só dentro do chat, sem gravar preferência global ao entrar.
- [ ] Lint, typecheck, testes e build passam (sem Docker/Playwright nesta entrega).

## Fora de Escopo

- Multi-sessão / títulos / lista de conversas.
- Playwright e verificação visual automatizada.
- Reintrodução do serviço Python `apps/chat`.
- Temas além de `zinc` / `emerald` / `light`.
- Billing, quotas comerciais ou multi-tenant.

## Riscos / Decisões

- Reasoning: persistência no DB é opcional nesta entrega — prioridade é stream live + UI; se não persistir, some no reload (aceitável no MVP).
- Home mobile após remoção de ingest/fila fica enxuta (saudação + stats/atalhos); conteúdo operacional migra para Biblioteca e `/fila`.
- Spec 053 (só logo, sem saudação) é supersedida neste ponto: empty state passa a ter boas-vindas com nome do user.

> 2026-07-12: decisões do owner — desktop `/`=chat; mobile `/`=home enxuta; ingest→biblioteca; fila dedicada; temas B; seletor no menu + toggle no header; tema no DB; reasoning streaming; sidebar colapsada só no chat.
