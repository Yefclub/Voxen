---
tipo: fix
titulo_en: Deleted TikTok posts report "removed" instead of an IP block
titulo_pt_br: TikToks apagados mostram "removido" em vez de bloqueio de IP
---

TikTok answers status 10204 ("status_deleted") for deleted or unavailable
posts, and yt-dlp words it as "Your IP address is blocked". Captures of those
posts now fail with "content removed or unavailable" instead of telling the
user that the server's IP is blocked.

<!-- pt-BR -->

O TikTok responde o status 10204 ("status_deleted") para posts apagados ou
indisponíveis, e o yt-dlp traduz isso como "Your IP address is blocked". A
captura desses posts agora falha com "conteúdo removido ou indisponível", em
vez de dizer que o IP do servidor foi bloqueado.
