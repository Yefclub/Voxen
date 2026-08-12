---
tipo: fix
titulo_en: A blocked YouTube download now names every way to unblock it
titulo_pt_br: Download bloqueado do YouTube agora mostra todos os caminhos para destravar
---

When YouTube refuses an automated download, the message you get is the only
guidance available — and it listed two of the three fixes this deployment
supports. The one it left out is the one that works on a rented server, which is
where the block almost always happens.

It now names all three, in the order worth trying: a PO token provider, a
residential proxy, or your YouTube cookies. Manual upload still works
immediately, and that is said first.

A related silence is gone too. Before downloading, the worker tries to fetch
existing captions, and a failure there was invisible in the logs. "This video
has no captions" and "the captions endpoint is blocked too" looked identical,
even though only the second one is worth acting on.

<!-- pt-BR -->

Quando o YouTube recusa um download automatizado, a mensagem é a única
orientação disponível — e ela listava duas das três soluções que esta instalação
suporta. A que ficou de fora é justamente a que funciona em servidor alugado,
que é onde o bloqueio quase sempre acontece.

Agora ela cita as três, na ordem que vale tentar: provider de PO token, proxy
residencial ou seus cookies do YouTube. Upload manual continua resolvendo na
hora, e isso é dito primeiro.

Um silêncio parecido também acabou. Antes de baixar, o worker tenta pegar
legendas já existentes, e uma falha ali era invisível nos logs. "Este vídeo não
tem legenda" e "o endpoint de legendas também está bloqueado" pareciam iguais,
embora só o segundo peça alguma ação.
