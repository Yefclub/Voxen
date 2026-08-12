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

**A regra é uma só: cor de superfície, texto ou borda tem de responder a `data-theme`.** Na prática isso significa token — e o sintoma de errar é silencioso, porque parece certo no pack em que você desenvolveu.

Formas que reprovam, todas pelo mesmo motivo: escala crua do Tailwind (`zinc-800`, `neutral-*`, `slate-*`), cor nomeada (`text-white`, `bg-black/55`), hex arbitrário em classe (`bg-[#18181b]` — note que só o `var()` salva a sintaxe de colchete), literal em JS ou CSS-in-JS (`rgb(...)`, `oklch(...)`, tema de editor, config de biblioteca) e `style={{ color: ... }}` inline. A lista é exemplo, não definição: o que decide é o teste acima.

**Exceção — teste, não rótulo.** A cor pode ser fixa se **carrega significado próprio** (ação, estado, categoria) **e** não deveria mudar entre packs. É o caso de `button.tsx` (`emerald`, `violet`, `rose`), do mapa de origem dos badges de ingestão e das séries de gráfico — inclusive nas bordas desses componentes, que carregam a mesma cor de categoria.

O que reprova é cor de **afordância**: borda de foco e anel de foco não significam nada, só indicam onde está o cursor. O idioma de foco do repo já é `ring-violet-500/40`; `ring-zinc-500/40` e `focus:border-zinc-500/60` são drift.

**Acento novo fora dos `--color-accent-*` existentes: confirmar com o owner antes.**

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

### Puxar componente de registry shadcn

`components.json` existe para o CLI do shadcn resolver alias e instalar dependência — **não** adota o tema do shadcn. Foi escrito à mão de propósito: `shadcn init` grava um bloco de variáveis CSS próprio no stylesheet alvo e define uma base color, exatamente o que não pode encostar no `index.css`.

**`--dry-run` antes de todo `add`, sem exceção.** Não rodar `init` não protege o `index.css` — o `add` escreve nele também. Dois danos reais, os dois medidos com `add sidebar --dry-run`:

- **Injeta variável CSS no `index.css`.** Item de registry que traz `cssVars` (`sidebar`, `chart` e outros) despeja o vocabulário do shadcn dentro do arquivo dos quatro packs. `add sidebar` reporta `16 CSS variables added to src/client/index.css`. O `components.json` aponta `"css": "src/client/index.css"`, então o alvo é o arquivo mais sensível do app.
- **Sobrescreve componente já restilizado.** O mesmo comando reporta `~6 overwrite` em `button`, `separator`, `sheet`, `tooltip`, `input` e `skeleton` — todos já convertidos à mão para `--color-app-*`. `--overwrite` é `false` por padrão, mas o dry-run é o único jeito de ver a lista antes.

Ler as **três** seções da saída — `Files`, `CSS` e `Dependencies` — não só o destino do arquivo.

```bash
pnpm dlx shadcn@latest add <componente> --dry-run     # sempre primeiro
pnpm dlx shadcn@latest add @ai-elements/<componente> --dry-run
```

O que o CLI entrega é **scaffolding**: colocação de arquivo, reescrita de import e instalação de dependência. Não entrega tema — componente de registry chega no vocabulário de token do shadcn (`--background`, `--primary`), que não existe aqui, então **todo componente puxado precisa de passe manual para `--color-app-*`** antes de entrar.

Três coisas que o arquivo não consegue explicar sozinho:

- `tailwind.config: ""` porque Tailwind v4 é CSS-first e não há `tailwind.config.ts`.
- `tailwind.baseColor: "zinc"` é exigido pelo schema mas é inerte aqui — nunca geramos o bloco de variáveis do shadcn. Não leia como afirmação sobre o tema.
- `iconLibrary` está ausente de propósito: este app não usa `lucide-react` nem `@radix-ui/react-icons`. Ícone vem de `@/components/ui/icons`. Componente de registry que importa `lucide-react` traz uma segunda biblioteca de ícones junto — pesar antes de aceitar.

`cssVariables: true` **não pode mudar depois** da inicialização, segundo a doc do shadcn. Está `true` porque assim o componente chega com nome semântico de token, mecanicamente substituível pelos nossos; `false` embutiria cor fixa (`bg-white dark:bg-neutral-950`), que é pior num app com quatro packs.

**Onde o arquivo cai, e o caso em que o alias não manda.** Item do registry padrão do shadcn respeita o alias: `add collapsible` grava em `src/client/components/ui/`, junto dos que já existem. Item que declara `target` próprio ignora tanto o alias quanto o `-p` — os do AI Elements declaram `components/ai-elements/<nome>.tsx` e caem em `src/components/ai-elements/`, fora da árvore do client. Compila (o `include` do tsconfig é `src/**/*`) e os imports `@/…` de dentro resolvem, mas cria diretório novo em `src/` fora do padrão.

Um `add` pode misturar os dois registries: `registryDependencies` sem URL resolve contra o **registry padrão do shadcn**, não contra o namespace de origem. Por isso `add @ai-elements/reasoning` arrasta um `collapsible` upstream para `ui/` — o AI Elements não publica esse item (404 no host deles).

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
