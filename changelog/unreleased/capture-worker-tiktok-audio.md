---
tipo: fix
titulo_en: TikTok speech is transcribed from the video's own audio
titulo_pt_br: A fala dos TikToks é transcrita do áudio do próprio vídeo
---

The capture worker no longer downloads TikTok's background music track, which
yt-dlp lists as the audio-only format. That track is often longer than the
video and has no speech, so transcripts came back empty. Audio now comes from
the video's own stream.

<!-- pt-BR -->

O worker de captura não baixa mais a música de fundo do TikTok, que o yt-dlp
lista como formato só de áudio. Essa faixa costuma ser mais longa que o vídeo e
não tem fala, então a transcrição voltava vazia. Agora o áudio vem do próprio
vídeo.
