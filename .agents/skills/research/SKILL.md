# Research — Pesquisa Estruturada com Trade-offs

Pesquisa sobre um tema, tecnologia ou abordagem, cruzando informações da web com o contexto atual do projeto.

## Inputs

- Tema: pergunta aberta ("melhor forma de fazer X"), comparação ("Y vs Z para nosso caso"), ou exploração ("o que existe de soluções para W")
- Contexto (opcional): restrições específicas do projeto

## Fluxo

### 1. Entender o Que Já Temos

Antes de pesquisar externamente, verificar como o problema é resolvido atualmente no projeto:
- Ler código relevante
- Verificar se já existe implementação parcial
- Entender as restrições da stack atual

### 2. Pesquisar Externamente

Usar WebSearch e WebFetch para:
- Documentação oficial das tecnologias consideradas
- Comparativos e benchmarks recentes
- Como projetos similares (open source) resolvem o mesmo problema
- Artigos técnicos com trade-offs reais (não marketing)
- Discussões em GitHub Issues, Stack Overflow, Reddit que mostrem problemas reais

### 3. Analisar no Contexto do Projeto

Para cada opção encontrada, avaliar:
- **Compatibilidade**: funciona com nossa stack sem reescrita?
- **Complexidade**: quanto esforço para implementar?
- **Manutenção**: vai criar dívida técnica? Dependência de lib externa?
- **Escalabilidade**: aguenta o crescimento esperado?
- **Comunidade**: tem suporte ativo? Risco de abandono?

### 4. Output

```markdown
# Pesquisa — [Tema]

## Contexto Atual no Projeto
- Como funciona hoje (se aplicável)
- Por que estamos buscando alternativa

## Opções Encontradas

### Opção A — [Nome]
- **O que é**: descrição em 2-3 frases
- **Prós**: (no contexto do projeto)
- **Contras**: (no contexto do projeto)
- **Esforço**: P/M/G
- **Referências**: [links]

### Opção B — [Nome]
- (mesma estrutura)

## Comparativo Rápido

| Critério | Opção A | Opção B | Opção C |
|----------|---------|---------|---------|
| Compatibilidade | | | |
| Complexidade | | | |
| Manutenção | | | |

## Recomendação
- Opção sugerida e por quê
- Ressalvas e riscos
- Próximo passo concreto se o usuário decidir seguir

## Referências
- [links consultados]
```

### Regras

- Nunca recomendar algo sem ter pesquisado — se não encontrou informação suficiente, dizer
- Priorizar fontes recentes (último ano) sobre artigos antigos
- Trade-offs devem ser específicos ao projeto, não genéricos
- Se o tema for sensível (migração de dados, mudança de infra), reforçar riscos
- É OK dizer "não achei evidência suficiente para recomendar" — melhor que inventar
- Não implementar nada durante pesquisa — apenas informar para decisão
