# 038 — Qualidade do agente de chat (Vox)

## Contexto

Feedback do owner: a Vox é "burra" — sabe ativar transcrição, mas conversa mal e,
principalmente, é ruim em pesquisar na internet. O diagnóstico do código (`apps/chat`)
mostrou que **o agente já tem as ferramentas** (21 tools, incluindo `web_search` via
OpenRouter), mas foi **instruído a se limitar**:

- System prompt restritivo: *"Responda EXCLUSIVAMENTE com base nas tools… Nunca
  invente"* e *"web_search APENAS pra info atual… base interna é primária"* — isso
  suprime conversa e trata busca na web como último recurso.
- Reasoning DESLIGADO por padrão (só no toggle "thinking").
- Sub-prompt de `web_search` genérico ("seja conciso") e poucos resultados.

O modelo (Gemini Flash lite) é mantido por decisão do owner — o foco é o sistema.

## Escopo

- Reescrever o system prompt da Vox para um parceiro de conversa que raciocina,
  pergunta quando ambíguo, sintetiza e **usa `web_search` proativamente**.
- Ligar reasoning por padrão (decisão do owner: qualidade > custo); toggle aprofunda.
- Tornar o `web_search` mais robusto (síntese rigorosa + mais resultados).
- Dar folga ao multi-passo (teto de tool-loops 5 → 8).

## Requisitos

### R1 — Prompt orientado a capacidade

- WHEN o agente recebe uma mensagem THEN o system prompt SHALL enquadrá-lo como
  parceiro de pensamento (conversar, raciocinar, esclarecer, sintetizar), NÃO como
  mero disparador de tools.
- WHEN a pergunta é sobre o acervo do usuário THEN SHALL usar as tools de
  busca/leitura e CITAR; WHEN é atual/externa/geral THEN SHALL usar `web_search`
  por conta própria, sem o usuário insistir.
- WHEN a pergunta é de conhecimento geral THEN o agente PODE responder do próprio
  repertório (não mais proibido), pesquisando na web se for volátil ou incerto.
- A regra antiga "EXCLUSIVAMENTE… nunca invente" SHALL NOT existir no prompt.

### R2 — Reasoning sempre ligado

- WHEN um turno é processado THEN reasoning SHALL ser enviado com `enabled: true`
  (effort `medium`; `high` quando o toggle thinking está ligado).
- `build_reasoning_config(thinking)` SHALL ser puro e testável.

### R3 — Web search robusto

- WHEN `web_search` roda THEN o sub-prompt SHALL pedir síntese rigorosa com cruzamento
  de fontes e citação por URL, e os limites SHALL ser ampliados (8 / 15).

### R4 — Multi-passo

- WHEN um turno exige vários passos THEN o teto de tool-loops SHALL ser 8.

## Fora de escopo

- Trocar o modelo (decisão do owner mantém Gemini Flash lite).
- Persistência/continuidade do chat contextual e UI (specs separadas).
- Reescrever o harness de tools ou a compactação.

## Critérios de aceite

- [ ] `build_system_prompt` reflete R1 (parceiro, web proativo, sem "EXCLUSIVAMENTE").
- [ ] `build_reasoning_config` sempre `enabled: true` (medium/high) — coberto por teste.
- [ ] Payload do `web_search` com síntese + limites 8/15 — coberto por teste.
- [ ] ruff, mypy e pytest do `apps/chat` verdes.
