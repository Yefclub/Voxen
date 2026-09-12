# Spec 179 — Canvas lateral de referências do chat

## Contexto

As citações verificadas do chat já possuem fonte, trecho e âncora navegável, mas
um clique interrompe a leitura ao trocar para a página completa da transcrição.
O chat precisa permitir inspeção da evidência no painel lateral existente sem
perder a conversa nem remover a opção de abrir a fonte completa.

## Requisitos

### Ubiquitous (sempre verdadeiros)

- The system shall manter a identidade, o trecho verificado, a localização e o
  estado de verificação de cada referência exibida no canvas.
- The system shall carregar conteúdo somente pela API autenticada e escopada ao
  usuário atual.
- The system shall preservar um caminho explícito para abrir a página completa
  da fonte.

### Event-driven (resposta a evento)

- When o usuário clicar em uma citação inline, the system shall abrir o painel
  lateral com a referência selecionada e seu conteúdo sem navegar para fora do
  chat.
- When o usuário clicar em uma referência da lista de fontes, the system shall
  substituir a lista pelo conteúdo da referência no mesmo painel.
- When o usuário voltar, the system shall restaurar a lista de referências da
  resposta sem fechar o painel.

### State-driven (durante um estado)

- While o conteúdo estiver sendo carregado, the system shall mostrar um estado
  de progresso dentro do canvas.
- While a referência estiver aberta em viewport mobile, the system shall manter
  o comportamento responsivo do painel existente.

### Unwanted behavior (condições de erro)

- If a fonte não existir, não pertencer ao usuário ou falhar ao carregar, then
  the system shall manter o chat aberto e mostrar um erro no canvas.
- If o usuário usar o caminho explícito da página completa, then the system
  shall preservar a navegação normal do navegador.

## Critérios de Aceite

- [x] Citações inline abrem o conteúdo no painel lateral sem trocar de rota.
- [x] Itens da lista de fontes abrem o mesmo canvas.
- [x] Voltar restaura a lista e fechar restaura a largura normal do chat.
- [x] A página completa da fonte continua acessível por ação explícita.
- [x] Estados de carregamento e erro funcionam em desktop e mobile.
- [x] Testes cobrem o contrato de abertura do canvas e a remoção da navegação
      direta como ação primária.

## Fora de Escopo

- Editar transcrições dentro do canvas.
- Exibir fontes externas de enriquecimentos que não façam parte das citações
  estruturadas do chat.
- Alterar a verificação ou persistência das evidências.

## Riscos / Decisões pendentes

- O canvas reutiliza o painel de fontes para evitar dois painéis concorrentes e
  mantém a página de detalhe como experiência completa.
