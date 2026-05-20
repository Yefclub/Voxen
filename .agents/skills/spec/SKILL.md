# Spec — Criar/Editar Spec em EARS

Skill p/ criar ou editar `.specs/<NNN>-<slug>.md` antes de qualquer feature não-trivial. Segue o padrão **EARS** (Easy Approach to Requirements Syntax) e é versionada junto do PR de implementação.

## Quando usar

- Antes de implementar qualquer feature que toque mais de 1-2 arquivos
- Antes de mudar contrato (API, schema do banco, formato do `.md` de transcrição)
- Quando o usuário descreve uma feature/comportamento e ainda não há spec
- Quando uma spec existente precisa ser atualizada após mudanças de requisitos

## Inputs

- Descrição informal da feature/comportamento (de conversa com o usuário)
- Slug curto e descritivo (ex: `setup-inicial`, `aprovacao-cadastro`, `download-transcrição`)
- Spec existente, se for edição

## Fluxo

### 1. Numerar e nomear

Buscar a maior numeração em `.specs/` e usar a próxima (3 dígitos): `000`, `001`, `002`...

```bash
ls .specs/ | sort | tail -1
```

Nome do arquivo: `.specs/NNN-slug-curto.md`.

### 2. Estruturar em EARS

A spec deve ter as seções abaixo. Para cada requisito, classificar e usar o padrão EARS correto:

```markdown
# Spec NNN — Título

## Contexto
- 1-2 parágrafos explicando o problema e o porquê
- Links pra ADRs ou docs relevantes

## Glossário (se útil)
- Termos do domínio que aparecem nos requisitos

## Requisitos

### Ubiquitous (sempre verdadeiros)
- The system shall <fazer X>.

### Event-driven (resposta a evento)
- When <evento>, the system shall <fazer X>.

### State-driven (durante um estado)
- While <estado>, the system shall <fazer X>.

### Optional (feature opcional)
- Where <feature está habilitada>, the system shall <fazer X>.

### Unwanted behavior (condições de erro)
- If <condição inválida>, then the system shall <fazer X>.

## Critérios de Aceite
- [ ] Lista checkável do que precisa funcionar pra spec ser considerada implementada
- [ ] Cada item testável (que vire teste TDD)

## Fora de Escopo
- O que NÃO faz parte dessa spec — clareza para evitar scope creep

## Riscos / Decisões pendentes
- Trade-offs conhecidos
- Pontos onde precisamos do user antes de finalizar
```

### 3. Co-autoria com o usuário

NÃO escrever a spec sozinho. Iterativamente:

1. Rascunhar com base no que entendi
2. Apresentar e perguntar: "Falta algo? Algum requisito está confuso?"
3. Refinar
4. Pedir aprovação explícita antes de fechar

### 4. Versionamento

A spec entra no MESMO PR da implementação (ou em PR separado de `docs/*` se for grande demais — neste caso, mergear a spec primeiro, depois abrir o PR de implementação referenciando ela).

Commit message ao adicionar/editar spec:
```
docs(spec): adiciona .specs/NNN-slug — <título>
```

### 5. Atualização

Quando requisitos mudarem durante implementação:
- Atualizar a spec ANTES de implementar a mudança
- Adicionar nota no histórico (rodapé): `> 2026-MM-DD: ajustado <item> porque <razão>.`

## Regras

- **EARS estrito**: cada requisito numa das 5 categorias acima. Não inventar padrões soltos
- **Português no Brasil**: spec em PT-BR, mas as palavras-chave EARS (`shall`, `when`, `while`, `where`, `if`) ficam em inglês — padrão internacional
- **Testável**: cada requisito deve ser implementável e testável. Se não dá pra escrever um teste, o requisito está vago
- **Sem implementação na spec**: spec descreve COMPORTAMENTO, não tecnologia. Sem nomes de arquivos, libs, código. Tecnologia vai em `docs/STACK.md` e ADRs
- **Sem ambiguidade**: "rapidamente", "em geral", "se possível" — banidos. Substituir por valores concretos

## Output esperado

Ao final, retornar:

```
.specs/NNN-slug.md criado
- N requisitos (ubiquitous: X, event: Y, state: Z, optional: W, unwanted: V)
- M critérios de aceite
Aprovado pelo user? sim/não
Próximo passo: implementação em PR `<tipo>/<slug>` referenciando a spec
```
