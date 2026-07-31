---
tipo: fix
titulo: Extensão mantém o progresso do envio ao fechar e reabrir o popup
---

Fechar o popup da extensão não perde mais o acompanhamento do envio. Antes, o
progresso vivia só na janelinha aberta: bastava clicar fora para o Chrome
descartar tudo e, ao reabrir, a extensão mostrava a tela inicial mesmo com a
transcrição rodando.

Agora, ao reabrir o popup:

- **Envio em andamento** volta com a barra de progresso e a etapa real
  (baixando, transcrevendo, gerando resumo…), além do botão "Ver na fila".
- **Envio que terminou com o popup fechado** aparece com o resultado — resumo e
  botão para abrir o conteúdo, ou a mensagem de erro se falhou. O resultado é
  mostrado uma vez; depois disso o popup volta ao normal.
- **Instância fora do ar ou sem rede** avisa que o acompanhamento está
  indisponível no momento, sem sumir com o envio nem fingir que terminou — e
  sem travar o botão: não saber em que pé está o envio anterior não impede
  mandar a próxima página. Acompanhamento que nunca resolve (instância trocada
  nas opções, job apagado no servidor) é descartado depois de algumas horas em
  vez de ficar para sempre.

Também nesta entrega, acabamento da extensão: cantos mais arredondados no
popup, página de conexão reorganizada em duas colunas (cabe sem rolagem, com o
bloco "Token Bearer" separado das ações principais por um divisor) e ícones da
barra do Chrome regerados a partir da arte em alta resolução, agora centrados e
mais nítidos em 16 px.
