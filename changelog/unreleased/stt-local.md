---
tipo: feat
titulo_en: Optional local speech-to-text sidecar
titulo_pt_br: Transcrição de fala local opcional
---

Self-hosted installs can now run an optional `stt-local` container that
transcribes speech on the server's own CPU with NVIDIA Parakeet TDT 0.6B v3,
without any provider key and without sending audio to the internet. Enable it
with the `stt-local` Compose profile and set `STT_LOCAL_URL`; it runs on an
internal-only network reachable by the web app alone (under Docker Compose),
keeps about 2.5 GB of RAM resident once used and handles one transcription at
a time. The web app starts using it with the upcoming `local` STT provider;
enabling the profile recreates `web` on the next `up`. Voxen keeps working
without it.

<!-- pt-BR -->

Instalações self-hosted agora podem rodar um container opcional `stt-local` que
transcreve fala na própria CPU do servidor com o NVIDIA Parakeet TDT 0.6B v3,
sem chave de provedor e sem enviar áudio para a internet. Ative com o profile
`stt-local` do Compose e defina `STT_LOCAL_URL`; ele roda numa rede só interna,
acessível apenas pelo app web (no Docker Compose), mantém cerca de 2,5 GB de RAM
residentes depois de usado e processa uma transcrição por vez. O app web passa
a usá-lo com o próximo provedor `local` de STT; ativar o profile recria o `web`
no próximo `up`. A Voxen continua funcionando sem ele.
