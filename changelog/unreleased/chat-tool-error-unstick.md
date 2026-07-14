---
tipo: fix
titulo: Erro de ferramenta deixa de travar o chat em “Pensando…”
---

Falhas de tool (ex.: transcrição) passam a marcar erro de verdade, curam
estados `running` órfãos e mostram fallback legível. O status inicial do
turno agora é “Buscando na sua biblioteca…”.
