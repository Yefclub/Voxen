# Spec 143 — Relações grounded entre claims do Brain

## Contexto

O Brain já armazena entidades e claims com trechos literais, mas ainda os conecta ao conteúdo apenas por menções. Isso impede explicar se uma fonte sustenta, contradiz ou apenas cita uma afirmação.

Esta spec materializa relações semânticas auditáveis sem converter inferência automática em fato. Relaciona-se à issue #541.

## Glossário

- **Claim:** afirmação curta extraída de uma fonte.
- **Relação grounded:** aresta semântica acompanhada de trecho literal e localização da fonte.
- **Alias:** nome alternativo de uma entidade, distinto de uma fusão automática de identidades.

## Requisitos

### Ubiquitous (sempre verdadeiros)

- The system shall persistir relações automáticas com sujeito, predicado, objeto, tipo, confiança, método e evidência literal.
- The system shall associar cada aresta automática a uma fonte do mesmo usuário e à sua localização por linhas e, quando disponível, segundos.
- The system shall distinguir suporte de contradição em arestas separadas e nunca apresentar claim automática sem ao menos uma evidência de suporte.
- The system shall preservar suporte independente por fonte, para que a remoção de uma fonte não elimine relações ainda sustentadas por outras fontes.

### Event-driven (resposta a evento)

- When um segmento grounded for compilado, the system shall materializar suas relações de suporte, contradição e aliases que tenham evidência literal válida.
- When uma relação de contradição for consultada, the system shall retornar as evidências das duas posições relacionadas.
- When uma evidência de segmento for reprocessada ou removida, the system shall remover somente as relações e suportes derivados daquela evidência.

### State-driven (durante um estado)

- While uma relação automática tiver menos de duas fontes conflitantes, the system shall não classificá-la como contradição entre fontes.
- While a confiança de equivalência estiver abaixo do limiar definido, the system shall manter entidades homônimas separadas e não criar `SAME_AS`.

### Optional (feature opcional)

- Where o modelo fornecer um alias de entidade com confiança suficiente e trecho literal, the system shall materializar a equivalência como `SAME_AS` auditável.

### Unwanted behavior (condições de erro)

- If o trecho de evidência de uma relação não estiver literalmente no segmento, then the system shall descartar a relação.
- If sujeito, predicado, objeto ou tipo de relação forem inválidos, then the system shall não criar a aresta.
- If a relação cruzar usuários, then the system shall rejeitar a materialização e a consulta.

## Critérios de Aceite

- [ ] Relações de suporte e contradição têm trechos e localização de origem.
- [ ] Claims automáticas sem suporte não são apresentadas como confirmadas.
- [ ] Contradições retornam evidência de cada lado.
- [ ] Alias exige confiança e não une homônimos ambíguos.
- [ ] Apagar uma fonte remove apenas seu suporte derivado.
- [ ] Testes cobrem suporte, contradição, alias, exclusão de fonte e isolamento por usuário.

## Fora de Escopo

- Ranking híbrido de busca e benchmark de qualidade (issues #539 e #542).
- Fusão destrutiva de nós de entidade.
- Edição manual de relações pelo grafo.

## Riscos / Decisões pendentes

- Contradição requer posições semanticamente opostas sobre o mesmo claim; divergência temática não basta.
- Alias automático permanece uma aresta reversível, não uma consolidação de identidades.
