---
tipo: fix
titulo: Conteúdo em markdown renderizado, reprocessar direto da fila e campo de link em destaque
---

Quatro correções no dia a dia de capturar e ler conteúdo.

**Análises em markdown voltam a aparecer formatadas.** Posts do X analisados por
IA (e qualquer conteúdo sem marcação de tempo) eram exibidos pelo leitor de
transcrição, que junta tudo num parágrafo só e mostra `##` e `**` crus. Agora a
página escolhe o modo de exibição pelo próprio conteúdo: com marcações de tempo,
segue a leitura por trechos clicáveis; sem elas, renderiza markdown com títulos,
listas, tabelas e negrito.

**Reprocessar item da fila.** Itens que falharam ou foram cancelados agora têm um
botão de reprocessar na própria fila — não é mais preciso recolar o link. Se o
conteúdo já estiver em processamento, já tiver sido indexado ou o servidor
recusar, o motivo aparece num aviso e o item continua como estava.

**Campo de colar link com destaque.** O placeholder longo com exemplos de URL deu
lugar a um "Cole o link aqui" direto, e o campo ganhou superfície elevada, borda
mais forte e realce de foco — é a ação principal da tela de conteúdo.

**Linha do tempo do job alinhada.** Os marcadores de cada etapa no histórico de um
job agora ficam centrados na linha vertical que os conecta.
