# apps/web — regras locais

Carrega automaticamente ao trabalhar em arquivos sob `apps/web/`.
Regras globais do repositório continuam no `CLAUDE.md` da raiz.

## Implementação de UI/UX

Voxen tem tema **cinza (zinc)** via Tailwind v4 + shadcn/ui. Modern e bonito. Ao implementar UI:

- Estudar componentes shadcn existentes antes de criar do zero
- Manter tema consistente (zinc-50 a zinc-950 como paleta principal)
- Acentos podem usar zinc + um destaque (mas confirmar com o user)
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

## Formato `.md` de transcrição

Cada vídeo transcrito vira um `.md` com frontmatter YAML + corpo com timestamps clicáveis. Schema completo em `docs/TRANSCRIPT-FORMAT.md`. O texto puro + frontmatter são espelhados em Postgres pra FTS rápida.
