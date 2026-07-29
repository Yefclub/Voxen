# Spec 115 — Fundação visual Linear e interface responsiva

## Status

Implementado em 2026-07-29.

## Contexto

A Voxen já possui tokens semânticos, componentes Radix no padrão shadcn e uma
navegação mobile dedicada. Ainda assim, as telas usam densidades, larguras,
ícones e elevações diferentes entre si. No desktop, vários fluxos ficam
limitados a `max-w-3xl` ou `max-w-5xl`, desperdiçando área útil. O tema escuro
atual também distribui peso visual demais entre fundo, sidebar, bordas e
decoração.

O Linear atual prioriza hierarquia, densidade e contraste: a navegação recua
visualmente para que o conteúdo principal domine, superfícies usam separação
sutil e a interface evita controles chamando atenção sem necessidade. A Voxen
deve adotar esses princípios sem copiar marca ou assets do Linear.

## Requisitos

### Ubiquitous

- The system shall oferecer um tema `linear` escuro baseado em tokens
  semânticos próprios da Voxen.
- The system shall usar `linear` como tema padrão para novos usuários, sessões
  sem preferência válida e bootstrap antes do carregamento da conta.
- The system shall preservar os temas existentes como opções explícitas.
- The system shall manter contraste AA para texto, estados de foco visíveis e
  suporte a `prefers-reduced-motion`.
- The system shall usar `@animateicons/react` como fonte dos ícones funcionais
  da aplicação, sem importar `lucide-react` diretamente no cliente.
- The system shall manter imports de ícones por subpath para permitir
  tree-shaking.
- The system shall centralizar largura, padding e cabeçalho das páginas em
  primitives reutilizáveis compatíveis com o padrão shadcn.
- The system shall ampliar a sidebar desktop expandida para melhorar leitura,
  árvore de notas e hierarquia da navegação.

### Event-driven

- When um usuário sem tema válido abrir a aplicação, the system shall aplicar o
  tema `linear` sem flash do tema legado.
- When um ícone interativo receber hover ou foco, the system shall poder animar
  sem alterar layout ou área de toque.
- When o sistema detectar preferência por movimento reduzido, the system shall
  desabilitar animações decorativas de ícones e transições GSAP.
- When uma página de trabalho for aberta em viewport desktop ampla, the system
  shall aproveitar a largura disponível até o limite apropriado ao tipo de
  conteúdo.

### State-driven

- While a sidebar estiver expandida, the system shall reservar a mesma largura
  no shell e no painel para impedir saltos de layout.
- While a sidebar estiver recolhida, the system shall manter o rail compacto e
  a área principal estável.
- While o drawer mobile estiver fechado, the system shall não manter árvore de
  notas ou navegação pesada montada fora de tela.
- While uma animação de entrada ou overlay estiver ativa, the system shall usar
  transform e opacity, sem animar propriedades que forcem layout contínuo.

### Unwanted behavior

- If `/` e `/chat` representarem o mesmo chat, then the system shall não exibir
  dois destinos redundantes no drawer/sidebar mobile.
- If um ícone equivalente não existir no pacote animado, then the system shall
  usar um wrapper visual compatível e documentado, sem reintroduzir
  `lucide-react` diretamente nas telas.
- If a viewport for estreita, then the system shall não aplicar larguras
  desktop nem criar overflow horizontal.
- If uma animação falhar ou JavaScript estiver reduzido, then the system shall
  manter conteúdo e controles utilizáveis.

## Critérios de Aceite

- [x] `linear` aparece primeiro no seletor, é o default do cliente/backend e
      possui tokens coerentes para fundo, sidebar, superfície, borda, texto e
      acento.
- [x] A sidebar expandida fica horizontalmente maior e o spacer acompanha a
      mesma constante.
- [x] Não há import direto de `lucide-react` em `apps/web/src/client`.
- [x] Ícones animados respeitam movimento reduzido e não alteram hit targets.
- [x] Page shell/header e data surface reutilizáveis existem e são adotados nas
      telas incluídas neste pacote.
- [x] Páginas desktop incluídas usam melhor a largura sem prejudicar leitura.
- [x] Drawer mobile continua sem “Início” redundante e os testes de swipe
      central/borda continuam verdes.
- [x] Typecheck, lint, testes unitários aplicáveis e build passam sem Docker nem
      Playwright local. Testes PostgreSQL ficam a cargo da CI.

## Fora de Escopo

- Redesenho completo da transcrição, novidades, grafo, notas e chat; cada área
  será migrada sobre esta fundação em pacotes seguintes.
- Alterar identidade visual, logotipo ou nome Voxen.
- Executar Docker ou Playwright localmente.
- Copiar código, marca ou assets proprietários do Linear.

## Decisões

- GSAP será usado apenas em transições coordenadas que se beneficiem de timeline
  ou controle de contexto React; animações simples continuam em CSS/motion.
- Componentes shadcn/Radix existentes serão evoluídos em vez de duplicados.
- O tema usa OKLCH/tokens semânticos para manter contraste e elevação coerentes.
