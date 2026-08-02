---
tipo: ui
titulo: Atualização automática, notificações de job e toasts mais estáveis no PWA
---

No app instalado (PWA), a nova versão passa a ser aplicada sozinha ao abrir o app
quando o chat não está respondendo — sem o modal de atualização a cada deploy.

Quando uma transcrição termina ou falha com o app em segundo plano e as
notificações estão permitidas, o sistema mostra uma notificação com a identidade
da Voxen (em vez de só um aviso interno ao voltar para a aba).

Toasts antigos não ficam “presos” nem reaparecem em fila depois de muito tempo
com a aba em background. Na tela de detalhe de um job em andamento, a
transcrição pronta abre automaticamente ao concluir.
