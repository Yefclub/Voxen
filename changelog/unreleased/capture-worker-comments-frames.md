---
tipo: feat
titulo_en: Capture worker returns comments, video keyframes and WAV audio
titulo_pt_br: Worker de captura retorna comentários, quadros de vídeo e áudio WAV
---

The capture worker now returns up to 50 top-level comments for YouTube,
TikTok and Instagram links (most liked first; X posts have none because
replies require sign-in) and reports whether a link has video. A new
`/v1/frames` endpoint extracts up to 4 keyframes from a small video stream so
videos can be analyzed visually, and audio can be requested as 16 kHz WAV for
the optional local speech-to-text service. Comment failures never fail a
capture.

<!-- pt-BR -->

O worker de captura agora retorna até 50 comentários principais de links do
YouTube, TikTok e Instagram (os mais curtidos primeiro; posts do X não têm
comentários porque as respostas exigem login) e informa se o link tem vídeo.
Um novo endpoint `/v1/frames` extrai até 4 quadros-chave de um stream de vídeo
pequeno para a análise visual dos vídeos, e o áudio pode ser pedido em WAV de
16 kHz para o serviço opcional de transcrição local. Falhas ao buscar
comentários nunca derrubam a captura.
