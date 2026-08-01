---
tipo: feat
titulo: Chat preparado para versionar mensagens, com histórico preso à trilha em uso
---

A conversa do chat deixou de ser uma lista e passou a ser uma árvore. Isso é o
alicerce do versionamento de mensagens: em breve vai dar para editar uma
pergunta sua e reenviá-la como uma trilha nova, mantendo a resposta anterior
guardada e navegável em vez de perdida.

Esta entrega é a metade de baixo — a que garante que a coisa funcione certo.
Os botões de versionar e de navegar entre versões chegam na próxima.

**O que muda desde já.** Cada mensagem passa a saber qual veio antes dela, e a
conversa passa a lembrar em qual trilha você estava. Isso vale inclusive depois
de recarregar a página: a trilha volta como estava, não como "a mensagem mais
recente que existir no banco".

**O que a Vox lê continua sendo só o que você está vendo.** Todo lugar que monta
o histórico da conversa — a resposta que ela gera, a organização automática da
memória quando a conversa fica longa, a restauração da tela ao abrir o chat —
passou a percorrer exatamente a trilha em uso. Uma resposta de uma trilha
abandonada nunca entra no contexto sem você ver.

**Conversas antigas continuam intactas.** Nada precisa ser migrado e nada some:
uma conversa criada antes desta mudança é lida como sempre foi, de ponta a
ponta, e não ganha nenhum indicador de versão na tela.

**A memória longa também respeita a trilha.** Quando a conversa fica grande e a
Vox resume a parte antiga para caber no contexto, o resumo agora pertence à
trilha em que foi feito e continua no caminho certo do histórico.
