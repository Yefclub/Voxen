# Skills — Voxen

Skills são fluxos completos para tarefas recorrentes. Cada uma vive em `.agents/skills/<nome>/SKILL.md` e o Claude/Codex lê o arquivo antes de executar a tarefa.

**Não há índice aqui de propósito.** A lista canônica é o próprio diretório, e o que decide quando cada skill é invocada é o campo `description` do frontmatter dela — é esse texto que o modelo lê. Índice paralelo desatualiza sem ninguém perceber: a tabela que existia aqui ficou uma skill atrás na primeira vez que uma nova foi criada.

```bash
ls .agents/skills/                                              # quais existem
grep -H -E '^(name|description):' .agents/skills/*/SKILL.md     # name + description de cada uma
```

Skill nova precisa de `name` e `description` no frontmatter. Sem eles ela não é indexada e o modelo nunca a invoca sozinho. Padrão do `description`: `Use quando <gatilho concreto> — <o que entrega>`, com as palavras que o usuário realmente digita.

Modelo de evolução: após executar uma skill, o agente pergunta se atendeu bem. Feedback edita o `SKILL.md` na hora — skills são vivos, não estáticos.
