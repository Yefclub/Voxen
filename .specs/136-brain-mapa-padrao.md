# Spec 136 — Mapa 2D recortado como padrão do Brain

## Contexto

A ADR-010 e a spec 103 definem o Brain como uma ferramenta de exploração rápida:
um mapa 2D recortado deve ser a primeira experiência, enquanto o snapshot
completo permanece um recurso explícito para diagnóstico. A página atual força o
snapshot amplo, contrariando essa decisão e aumentando o ruído visual.

## Glossário

- **Mapa**: recorte contextual do Brain, limitado a 180 nós e 400 relações.
- **Completo**: snapshot amplo para diagnóstico e bases pequenas.
- **Seleção**: nó escolhido pelo usuário, inclusive quando uma troca de modo ou
  visualização o deixa temporariamente fora do recorte.

## Requisitos

### Ubiquitous

- The system shall abrir `/grafo` com a visualização `map` e o renderer 2D.
- The system shall limitar a visualização `map` a 180 nós e 400 relações.
- The system shall manter a visualização `full` disponível como uma ação explícita.
- The system shall manter a seleção de um nó ao alternar entre renderer 2D e 3D,
  e entre visualizações `map` e `full`.
- The system shall mostrar no inspetor de cada conexão o tipo, método, confiança
  e origem da evidência usados para criar a relação.

### Event-driven

- When a página do Brain solicitar o grafo pela primeira vez, the system shall
  enviar `view=map` e não solicitar `view=full`.
- When o usuário selecionar Mapa ou Completo, the system shall solicitar a
  visualização correspondente sem limpar a seleção existente.
- When a visualização `map` contiver relações fracas, the system shall omitir as
  relações conforme os critérios da spec 103.

### State-driven

- While a visualização ativa não contiver o nó selecionado, the system shall
  reter sua seleção para restaurá-la se ele voltar a ficar visível.

### Optional

- Where o usuário alternar para o renderer 3D, the system shall carregar o
  renderer 3D sob demanda e manter a seleção atual.

### Unwanted behavior

- If uma visualização não for reconhecida, then the system shall usar `map` como
  padrão seguro e rápido.

## Critérios de Aceite

- [ ] Uma chamada sem `view` retorna o recorte `map`.
- [ ] O primeiro request de `/grafo` usa `view=map`; o usuário pode solicitar
      `view=full` explicitamente.
- [ ] O recorte `map` nunca excede 180 nós ou 400 relações e omite relações fracas.
- [ ] A seleção persiste nas alternâncias 2D/3D/map/full e o deep-link de fonte
      continua disponível quando o nó está visível.
- [ ] O inspetor mostra tipo, método, confiança e evidência de cada conexão.
- [ ] Testes cobrem o padrão, a query da UI, o recorte e a retenção de seleção.

## Fora de Escopo

- Novo algoritmo de layout, embeddings ou extração por LLM.
- Alterar os critérios de criação de relações no indexador Brain.
- Adicionar novas visualizações além de 2D e 3D.

## Riscos / Decisões pendentes

- Um nó selecionado pode não aparecer no recorte `map`; a seleção é retida sem
  exibir um inspetor para um nó ausente e reaparece ao voltar ao modo que o contém.

> 2026-08-02: requisitos derivados da issue #537, ADR-010 e spec 103; aprovação
> global do objetivo de implementação completa das issues já registrada pelo owner.
