# Voxen — Regras Globais (Codex / OpenAI)

> Este arquivo é o equivalente do `CLAUDE.md` para o **Codex/OpenAI**. Conteúdo idêntico, apenas com paths `.agents/` ao invés de `.claude/`. Em projetos novos, mantenha os dois sincronizados.

As skills, agentes e configurações do Codex vivem em `.agents/`, espelhadas a partir de `.claude/`.
O arquivo `.claude/settings.local.json` não é espelhado por ser configuração local.

**`.claude/` é a fonte; `.agents/` é gerado.** Editou um arquivo em `.claude/`? Regenere e commite o espelho junto, no mesmo PR:

```bash
node scripts/agents-mirror.mjs --fix    # regenera
node scripts/agents-mirror.mjs          # confere (exit 1 se divergir)
```

O CI roda essa conferência como teste em `Test TS (apps/web)`, então PR que mexe numa árvore só falha. Editar `.agents/` à mão não adianta — a próxima regeneração desfaz.

**O que não é espelhado**, porque espelhar é copiar e uma cópia não pode promover estado local para dentro de árvore versionada: tudo que o `.gitignore` ignora (consultado via `git check-ignore`), mais uma rede estática que vale mesmo sem git — `settings.local.json`, `scheduled_tasks.lock`, `master.key`, `.env*`, `*.key`/`*.pem`/`*.p12`, e qualquer coisa sob `worktrees/`, `secrets/`, `node_modules/` ou `.git/`, em qualquer nível. Symlink também fica de fora. O comando informa quantos caminhos pulou.

A reescrita de path (`.claude/` → `.agents/`) é textual e incondicional, e só se aplica a arquivo UTF-8 válido — binário é copiado byte a byte. Se algum arquivo precisar manter uma referência literal a `.claude/`, exclua-o em `scripts/agents-mirror-lib.mjs` em vez de editar o espelho.

Consulte `CLAUDE.md` na raiz como **fonte única de verdade** das regras do projeto.
