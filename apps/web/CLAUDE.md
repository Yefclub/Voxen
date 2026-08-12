# apps/web — regras locais

Carrega automaticamente ao trabalhar em arquivos sob `apps/web/`.
Regras globais do repositório continuam no `CLAUDE.md` da raiz.

## Implementação de UI/UX

Tailwind v4 + shadcn/ui, com design system próprio — **não** o tema padrão do shadcn.

**Quatro packs de tema**, escolhidos por `documentElement[data-theme]`: `linear` (default), `zinc`, `emerald` e `light`. `zinc` é um pack entre quatro, não "a paleta" — e a escala crua `zinc-50…zinc-950` do Tailwind não é fonte de verdade de nada.

Histórico, porque a atribuição erra fácil: a spec 073 criou o sistema de temas com `zinc` como padrão; foi a **115** que introduziu o `linear` e o tornou default, e a **129** trocou só o rótulo exibido para "Voxen", mantendo o identificador. Citar a 073 pelo estado atual manda o leitor a um documento que diz `zinc (padrão)`.

**Tokens semânticos são a fonte de verdade.** Superfície, texto e borda saem de `--color-app-*`; destaque sai de `--color-accent-*`. Há também escalas próprias de `--radius-*`, `--ease-*` e o trio de fontes. Os valores vivem em `src/client/index.css` — ler de lá, não daqui, porque valor copiado envelhece.

```tsx
// certo
<div className="bg-[var(--color-app-surface)] text-[var(--color-app-fg)]" />
// errado — não bate com token em pack nenhum, e quebra visualmente em `light`
<div className="bg-zinc-800 text-zinc-100" />
```

**Proibida cor de superfície, texto ou borda que não venha de token.** Vale para escala crua do Tailwind (`zinc-*`, `neutral-*`, `slate-*`) e igualmente para literal em JS ou CSS-in-JS (`#18181b`, `rgb(...)`, `oklch(...)`) — tema de editor e config de biblioteca contam. Nada disso responde a `data-theme`, e o sintoma é silencioso: parece certo no pack em que você desenvolveu.

**Exceção — teste, não rótulo.** A cor pode ser fixa se **carrega significado próprio** (ação, estado, categoria) **e** não deveria mudar entre packs. É o caso de `button.tsx` (`emerald`, `violet`, `rose`), do mapa de origem dos badges de ingestão e das séries de gráfico. Foco e borda **não** passam nesse teste: são afordância, não significado — e o idioma de foco do repo já é `ring-violet-500/40`, não cinza. Acento novo fora dos `--color-accent-*` existentes: confirmar com o owner antes.

Além disso:

- Estudar componentes existentes em `src/client/components/ui/` antes de criar do zero
- Markdown rendering deve respeitar o tema (cores e tipografia consistentes)

### Verificação Visual com Playwright (OBRIGATÓRIO para mudanças de UI)

Antes de commitar QUALQUER fix visual ou mudança de UI:

1. Abrir a página afetada via Playwright e tirar screenshot do estado atual (antes)
2. Aplicar as mudanças
3. Tirar screenshot do resultado (depois) e analisar visualmente
4. Para modais/botões/interações: **clicar em CADA elemento** e verificar resultado
5. Verificar: alinhamento, contraste, hover states, z-index, animações, overflow de texto, responsividade
6. Se o usuário enviar prints/screenshots — verificar PRIMEIRO no ambiente local via Playwright. NUNCA assumir que são de outro ambiente. Investigar, não descartar.

## Agente sem embeddings (harness/Karpathy)

O chat-agente integrado NÃO depende de embeddings/RAG vetorial. Em vez disso,
recebe tools:

- `list_transcripts(workspace_id)` → metadata
- `search_transcripts(workspace_id, query)` → Postgres FTS, retorna trechos com timestamps
- `read_transcript(id)` → markdown completo
- `read_transcript_section(id, from_ts, to_ts)` → recorte
- `get_metadata(id)` → frontmatter

Ao adicionar tool nova, manter o padrão: tools devem ser **simples, determinísticas, sem efeito colateral** (read-only sobre a Base de conhecimento). Decisão em `docs/DECISIONS.md` ADR-004.

O formato `.md` que essas tools leem é gerado pelo worker — contrato em `docs/TRANSCRIPT-FORMAT.md`, regras em `apps/worker/CLAUDE.md`.
