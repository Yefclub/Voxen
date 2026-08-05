# Spec 169 — Feed de novidades localizado por ambiente

## Contexto

A página `/novidades` já reconhece se a instância executa uma versão de
desenvolvimento ou uma versão estável, mas usa essa informação apenas como um
indicador visual. O feed continua permitindo que uma instância de produção
exiba entradas de desenvolvimento e vice-versa. Além disso, as notas de
release são armazenadas como texto único, o que faz a interface localizada
misturar conteúdo em português e inglês.

## Glossário

- **Ambiente da instância**: canal derivado da versão efetivamente servida:
  desenvolvimento para versões com sufixo `-dev.` e produção para versões
  estáveis.
- **Nota localizada**: título, resumo e corpo disponíveis em `pt-BR` e `en`.
- **Canal do feed**: classificação de uma entrada como `dev` ou `prod`.

## Requisitos

### Ubiquitous (sempre verdadeiros)

- The system shall servir somente entradas do canal correspondente ao ambiente
  efetivo da instância.
- The system shall renderizar título, resumo, corpo e mudanças promovidas no
  idioma escolhido pela pessoa, com inglês como fallback quando uma tradução
  estiver ausente.
- The system shall continuar aceitando entradas históricas de texto único sem
  interromper a renderização do feed.
- The system shall expor o ambiente efetivo apenas como indicador informativo,
  nunca como uma escolha que mude o canal servido.

### Event-driven (resposta a evento)

- When uma pessoa altera o idioma da interface, the system shall atualizar as
  notas localizadas sem alterar os demais filtros do feed.
- When uma requisição para o feed incluir um canal diferente do ambiente
  efetivo, the system shall ignorar essa tentativa e retornar somente o canal
  permitido.

### State-driven (durante um estado)

- While uma instância estiver em produção, the system shall ocultar controles
  e resultados de desenvolvimento.
- While uma instância estiver em desenvolvimento, the system shall ocultar
  controles e resultados de produção.

### Unwanted behavior (condições de erro)

- If uma nota não possuir tradução para o idioma solicitado, then the system
  shall mostrar o fallback disponível sem exibir valor estruturado, vazio ou
  serializado.
- If o idioma ou canal enviado por uma requisição for inválido, then the system
  shall manter o comportamento seguro padrão do feed, sem ampliar o conjunto
  de entradas visíveis.

## Critérios de Aceite

- [ ] Uma instância `-dev.` recebe exclusivamente entradas `dev`, mesmo com
      `?channel=prod` na URL ou na API.
- [ ] Uma instância estável recebe exclusivamente entradas `prod`, mesmo com
      `?channel=dev` na URL ou na API.
- [ ] A página não mostra seletor de ambiente e mantém um selo informativo do
      ambiente atual.
- [ ] Uma entrada localizada mostra conteúdo PT-BR ou inglês de acordo com o
      idioma da interface.
- [ ] Uma entrada histórica de texto único permanece legível em ambos os
      idiomas.
- [ ] Busca, filtro por tipo e paginação permanecem funcionais dentro do canal
      permitido.
- [ ] Testes de unidade cobrem a imposição de ambiente e a resolução de
      idioma; testes de interface cobrem os controles disponíveis.

## Fora de Escopo

- Tradução automática de notas em tempo de execução.
- Consultar GitHub em tempo de execução para obter releases.
- Alterar o histórico de texto já publicado sem uma tradução curada.

## Riscos / Decisões pendentes

- O canal precisa ser imposto no servidor para que parâmetros de URL não
  alterem a experiência do ambiente.
- A migração do pipeline de changelog deve preservar a compatibilidade com o
  formato histórico durante a adoção gradual de notas bilíngues.

> 2026-08-05: criado a partir da decisão do owner de localizar Novidades e
> restringir automaticamente o feed ao ambiente real da instância.
