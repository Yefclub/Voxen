# Skills — Voxen

Skills são fluxos completos para tarefas recorrentes. Cada uma vive em `.agents/skills/<nome>/SKILL.md` e o Codex lê o arquivo antes de executar a tarefa.

| Skill | Quando usar | Trigger natural |
|-------|-------------|-----------------|
| `architect` | Discovery e scaffolding de novos projetos/módulos | "quero construir X" |
| `audit` | Auditoria profunda de código por módulo/concern | "analisa o módulo X" |
| `changelog` | Resumo executivo de atividade p/ gestão | "o que fizemos essa semana?" |
| `ci-status` | Panorama de PRs abertas e estado do CI | "como estão as PRs?" |
| `monday` | Integração com Monday.com via MCP | "atualiza o Monday" |
| `release` | Preparar PR de release dev→main | "prepara a release" |
| `research` | Pesquisa estruturada com trade-offs | "pesquisa sobre Y" |
| `review-pr` | Revisão técnica automatizada de PR | "review da PR #N" |
| `ship` | Branch → PR → CI → review → merge | "shipa isso" |
| `spec` | Criar/editar `.specs/<slug>.md` em EARS | "spec p/ feature X" |
| `sprint-summary` | Radiografia técnica do projeto p/ o dev | "como está o projeto?" |
| `triage` | Triagem e categorização de issues | "organiza as issues" |

Modelo de evolução: após executar uma skill, o agente pergunta se atendeu bem. Feedback edita o `SKILL.md` na hora — skills são vivos, não estáticos.
