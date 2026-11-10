---
tipo: feat
titulo_en: Optional local speech-to-text sidecar
titulo_pt_br: Transcrição de fala local opcional
---

Self-hosted installs can now run an optional `stt-local` service that
transcribes speech on the server's own CPU with NVIDIA Parakeet TDT 0.6B v3,
without any provider key and without sending audio to the internet. Enable it
with the `stt-local` Compose profile and set `STT_LOCAL_URL`; it runs on an
internal-only network reachable by the web app alone, uses about 2.5 GB of RAM
while transcribing and handles one transcription at a time. Voxen keeps
working without it.

<!-- pt-BR -->

Instalações self-hosted agora podem rodar um serviço opcional `stt-local` que
transcreve fala na própria CPU do servidor com o NVIDIA Parakeet TDT 0.6B v3,
sem chave de provedor e sem enviar áudio para a internet. Ative com o profile
`stt-local` do Compose e defina `STT_LOCAL_URL`; ele roda numa rede só interna,
acessível apenas pelo app web, usa cerca de 2,5 GB de RAM durante a
transcrição e processa uma transcrição por vez. A Voxen continua funcionando
sem ele.
