# Triage — Triagem e Categorização de Issues

Lê issues abertas, categoriza por área/prioridade/esforço, detecta duplicatas e sugere agrupamento para sprints.

## Inputs

- Escopo: `all` (todas abertas), números específicos (`#100 #101 #102`), ou label (`bug`, `enhancement`)
- Ação (opcional): `categorizar`, `priorizar`, `planejar-sprint`, `detectar-duplicatas`

## Fluxo

### 1. Coletar Issues

```bash
# Todas abertas
gh issue list --state open --json number,title,body,labels,assignees,createdAt,comments --limit 100

# Ou por label
gh issue list --state open --label "bug" --json number,title,body,labels,assignees,createdAt
```

### 2. Para cada issue, analisar

- **Área**: qual módulo/parte do sistema afeta
- **Prioridade**: crítica (produção quebrada), alta (funcionalidade comprometida), média (melhoria importante), baixa (nice-to-have)
- **Esforço**: P (poucas horas), M (1-2 dias), G (3+ dias)
- **Dependências**: precisa de outra issue antes? bloqueia outra?

### 3. Detectar Duplicatas/Sobreposições

Comparar títulos e corpos das issues para identificar:
- Issues que descrevem o mesmo problema com palavras diferentes
- Issues que tocam os mesmos arquivos/módulos e poderiam ser agrupadas
- Issues que conflitam entre si

### 4. Output

```markdown
# Triagem — [Data]

## Por Prioridade

### Crítica
- #N — título [área] [esforço: P/M/G]

### Alta
- #N — título [área] [esforço: P/M/G]

### Média / Baixa
- #N — título [área] [esforço: P/M/G]

## Duplicatas/Sobreposições Detectadas
- #N e #M parecem tratar do mesmo problema (motivo)
- #N e #O tocam os mesmos arquivos — considerar agrupar

## Sugestão de Sprint
Baseado na prioridade e esforço:
- Sprint atual: #N, #M, #O (esforço total estimado: X dias)
- Próxima sprint: #P, #Q
- Backlog: #R, #S

## Issues sem Informação Suficiente
- #N — falta: (reprodução, contexto, critério de aceite)
```

### Regras

- Ler o CORPO da issue, não apenas o título — triagem baseada só no título é superficial
- Se a issue não tem informação suficiente para triagem, sinalizar ao invés de adivinhar
- Priorização deve considerar impacto no usuário final, não complexidade técnica
- Nunca fechar ou modificar issues durante triagem — apenas reportar
