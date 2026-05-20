# Audit — Auditoria Focada de Código

Analisa uma área específica do codebase com profundidade, lendo código real antes de qualquer afirmação.

## Inputs

- Alvo: módulo, camada, ou concern (`segurança`, `performance`, `tipos`, `testes`)
- Profundidade (opcional): `rápida` (overview), `completa` (arquivo por arquivo)

## Fluxo

### 1. Mapear Escopo

Identificar todos os arquivos relevantes para o alvo:
```bash
# Por módulo — ajuste os paths para seu projeto
find src/modules/[modulo] -name "*.ts" | head -50

# Por concern (ex: segurança)
# auth middleware, guards, token handling, input validation, etc.
```

### 2. Ler Código Real

**OBRIGATÓRIO**: Ler cada arquivo relevante antes de fazer qualquer afirmação. Não usar memória de sessões anteriores, não assumir comportamento baseado em nome de arquivo.

### 3. Analisar por Concern

**Segurança**:
- Input validation (schemas de validação completos?)
- Auth guards em todas as rotas protegidas
- SQL injection / NoSQL injection
- XSS em outputs do frontend
- Secrets expostos em código
- Rate limiting em endpoints públicos

**Performance**:
- Queries N+1 no ORM
- Falta de índices no schema
- Re-renders desnecessários (subscrições de state amplas demais)
- Payloads grandes sem paginação
- Falta de cache onde faria sentido

**Tipos**:
- Uso de `any` desnecessário
- Schemas de validação desalinhados com tipos TypeScript
- Props não tipadas em componentes

**Testes**:
- Cobertura de testes por módulo
- Testes que testam implementação ao invés de comportamento
- Mocks que escondem bugs reais

### 4. Output

```markdown
# Auditoria — [Alvo] ([Concern])

## Escopo Analisado
- X arquivos lidos em [diretórios]

## Problemas Encontrados

### Críticos (corrigir antes de merge/release)
- [arquivo:linha] — descrição do problema + sugestão de fix

### Importantes (corrigir em breve)
- [arquivo:linha] — descrição + sugestão

### Sugestões (melhoria, não urgente)
- [arquivo:linha] — descrição

## Pontos Positivos
- (o que está bem feito — não focar só no negativo)

## Próximos Passos Sugeridos
- (issues para criar, refatorações, etc.)
```

### Regras

- NUNCA afirmar que algo é seguro/performático sem ter lido o código
- Citar arquivo e linha para cada achado
- Diferenciar problemas reais de opiniões estilísticas
- Se o escopo for muito grande para análise completa, informar o que foi coberto e o que ficou de fora
- Não criar issues automaticamente — apenas sugerir. Criação é decisão do usuário
