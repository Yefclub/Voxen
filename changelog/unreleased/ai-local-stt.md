---
tipo: feat
titulo_en: Local speech-to-text on your own server
titulo_pt_br: Transcrição local no seu próprio servidor
---

When the optional `stt-local` sidecar is running, **Account → AI providers**
offers "Local (Parakeet, on this server)" in the speech-to-text chain. It needs
no key, costs nothing and keeps audio on your server. It is never added to a
chain on its own: you choose it. While the sidecar is down, the entry shows as
unavailable and the next model in the chain transcribes instead.

<!-- pt-BR -->

Com o serviço opcional `stt-local` rodando, **Conta → Provedores de IA** oferece
"Local (Parakeet, no servidor)" na lista de transcrição. Não precisa de chave,
não tem custo e o áudio fica no seu servidor. Ele nunca entra numa lista
sozinho: é você quem escolhe. Enquanto o serviço estiver fora do ar, a entrada
aparece como indisponível e o próximo modelo da lista transcreve no lugar.
