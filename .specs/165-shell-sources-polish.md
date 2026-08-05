# Spec 165 — Polimento do rail, fontes e rolagem

## Contexto

No modo de interface focada, a margem entre o rail recolhido e a superfície
principal faz o eixo visual dos ícones parecer deslocado para a esquerda. No
chat desktop, a abertura das fontes altera o espaço do conteúdo sem transição e
o painel compete com o cabeçalho flutuante. As setas nativas da barra de
rolagem também permanecem próximas demais dos cantos arredondados.

Esta spec define o comportamento visual do shell sem alterar navegação,
citações, conteúdo das fontes ou o `Sheet` usado no mobile.

## Glossário

- **Rail**: estado recolhido da sidebar desktop.
- **Superfície principal**: área arredondada onde a rota ativa é renderizada.
- **Fontes**: evidências associadas a uma resposta do chat.
- **Controle de extremidade**: botão de seta inicial ou final da barra de rolagem.

## Requisitos

### Ubiquitous (sempre verdadeiros)

- The system shall centralizar horizontalmente cada controle do rail dentro do espaço visual disponível entre a borda da viewport e a superfície principal.
- The system shall manter somente um controle de decremento no início e um controle de incremento no fim de cada barra de rolagem desktop.
- The system shall reservar 24 px no eixo de rolagem para cada controle de extremidade.

### Event-driven (resposta a evento)

- When o usuário abrir as fontes de uma resposta no desktop, the system shall retrair a área principal do chat e revelar a região de fontes com uma transição visual.
- When o usuário fechar as fontes no desktop, the system shall expandir a área principal e ocultar a região de fontes com uma transição visual.
- When a região de fontes estiver aberta no desktop, the system shall deslocar o cabeçalho flutuante para que ele não cubra o título nem as evidências.

### State-driven (durante um estado)

- While a região de fontes estiver aberta no desktop, the system shall apresentá-la como parte do fundo do shell, sem aparência de painel elevado ou sobreposto.
- While `prefers-reduced-motion` estiver ativo, the system shall aplicar as mudanças de geometria sem animação prolongada.

### Optional (feature opcional)

- Where a viewport for mobile, the system shall manter as fontes no `Sheet` responsivo existente.

### Unwanted behavior (condições de erro)

- If a resposta não tiver fontes abertas, then the system shall manter a largura normal do chat e a posição padrão do cabeçalho.

## Critérios de Aceite

- [x] O eixo dos controles do rail coincide com o centro do espaço visual no modo focado.
- [x] Abrir e fechar fontes no desktop anima tanto a retração do chat quanto a entrada/saída das fontes.
- [x] O cabeçalho flutuante não cobre o cabeçalho ou a lista de fontes.
- [x] A região de fontes não usa borda divisória nem superfície elevada própria.
- [x] O mobile continua usando o `Sheet` existente.
- [x] Cada seta desktop possui 24 px de área no eixo e apenas as extremidades lógicas ficam visíveis.
- [x] `prefers-reduced-motion` elimina a animação prolongada.

## Fora de Escopo

- Alterar o conteúdo, a verificação ou a navegação das citações.
- Alterar a largura da sidebar expandida.
- Trocar o componente de fontes no mobile.
- Redesenhar o cabeçalho flutuante ou os temas da aplicação.

## Riscos / Decisões pendentes

- A largura das fontes permanece em 22 rem para preservar a densidade atual das evidências.
- A centralização adicional do rail aplica-se ao modo focado, onde existe a margem estrutural de 8 px.
