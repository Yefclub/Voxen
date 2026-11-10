# Voxen local speech-to-text (`stt-local`)

Optional sidecar (spec 221, ADR-015) that transcribes speech on the CPU with
NVIDIA Parakeet TDT 0.6B v3 (int8 ONNX), served by the
[`achetronic/parakeet`](https://github.com/achetronic/parakeet) Go server
behind an OpenAI-compatible endpoint. It needs no provider key, holds no
secrets and, under Docker Compose, has no network egress. Voxen works without
it. The web app uses it through the keyless `local` STT provider; when the sidecar
is not running, that entry is skipped (or fails as retryable mid-call) and the
chain moves on.

## Endpoint

Port `5092`, reachable only from `web` on the internal `stt-net` network
(Compose; see the deploy docs for the Easypanel/Openship residual risk).

| Method and path                 | Purpose                                                                                                                |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                   | `{"status":"ok"}` once the model is loaded.                                                                            |
| `POST /v1/audio/transcriptions` | OpenAI-compatible multipart (`file`, optional `language`, `response_format` `json`/`text`/`verbose_json`/`srt`/`vtt`). |
| `GET /v1/models`                | Model list.                                                                                                            |

Input must be **WAV** (16 kHz mono PCM is what the worker sends); anything
else returns HTTP 400 because the image has no ffmpeg. Audio longer than 60 s
is split into 60 s windows with 15 s overlap inside the server. Voxen sends
chunks of at most 8 minutes.

## Fixed flags and configuration

The entrypoint always runs `-workers=1 -ffmpeg=false -enable-diarization=false`
(one transcription at a time, WAV only, no diarization). The image sets:

| Variable                              | Value                                                   |
| ------------------------------------- | ------------------------------------------------------- |
| `PARAKEET_PORT`                       | `5092`                                                  |
| `PARAKEET_MODELS`                     | `/models`                                               |
| `PARAKEET_MODEL_PRECISION`            | `int8`                                                  |
| `PARAKEET_LONG_AUDIO`                 | `true`                                                  |
| `PARAKEET_DISABLE_VAD_BASED_CHUNKING` | `true` (no Silero VAD; chunk boundaries use mel energy) |
| `PARAKEET_LOG_FORMAT`                 | `json`                                                  |
| `GOMEMLIMIT`                          | `600MiB`                                                |

`PARAKEET_CHUNK_SECONDS` lowers peak memory at the cost of speed (40 s
windows: about 1.9 GiB peak but roughly 40% slower). Do not set
`PARAKEET_API_KEY`: the network is the access boundary and Voxen sends no key.

## Enabling it

Docker Compose:

```bash
docker compose --profile stt-local up -d --build stt-local
# in .env, then recreate web:
STT_LOCAL_URL=http://stt-local:5092
docker compose up -d web
```

`stt-local` attaches only to `stt-net` (`internal: true`), which `web` also
joins and `capture-worker` does not. It publishes no ports and runs as uid
10002 with a read-only root filesystem, a 256 MiB `/tmp` tmpfs (multipart
uploads), all capabilities dropped, `no-new-privileges`, 2 CPUs and a 3 GB
memory limit.

Then each user adds it to their speech-to-text chain in **Account → AI
providers** (`/conta/ia`): in the **Transcription (STT)** list, pick "Local
(Parakeet, on this server)" and save. It is never added automatically. The
option appears only while `STT_LOCAL_URL` is set and `GET /health` answers
(checked with a 2 s timeout, cached 30 s); a stored entry shows "unavailable"
and is skipped while the sidecar is down. It only takes WAV: when it is the
first available entry and the duration is known and at most 1 h, the capture
pipeline requests WAV audio from the worker;
with MP3 audio `local` entries are skipped. Cloud entries after it act as
fallbacks.

Easypanel and Openship: see "Optional local speech-to-text" in
[`docs/en/DEPLOY.md`](../../docs/en/DEPLOY.md).

## Resource use

Measured on a 2014 4-core host (Intel Core i5-4590S, no GPU) with the Compose
limits (2 CPUs):

| Audio                          | Latency | Peak RAM |
| ------------------------------ | ------- | -------- |
| idle, model loaded             | n/a     | ~0.9 GiB |
| 30 s PT-BR speech              | ~7 s    | ~1.2 GiB |
| 8 min PT-BR speech (one chunk) | ~155 s  | ~2.5 GiB |

Memory is mostly the ONNX Runtime arena and stays near the peak after the
first long request. The image is about 755 MB on disk (510 MB compressed),
almost all of it the model.

## Pins

Every artifact is pinned in the `Dockerfile` and checked at build time:

- **Server**: `achetronic/parakeet` tag `v0.11.0`, commit
  `28125a56bcb69e603eb731951e1657ae3a86e264`, built from source with its
  `go.sum` (`github.com/yalue/onnxruntime_go` v1.30.1).
- **Model**: `ghcr.io/achetronic/parakeet-models-asr-int8:v0.11.0`, index
  digest `sha256:63f1c849817c929100c5841f02be9b36e01fc29556774f4f2c1830b50caec141`;
  only `config.json`, `vocab.txt`, `encoder-local.int8.onnx` and
  `decoder_joint-model.int8.onnx` are copied, each verified by sha256.
- **ONNX Runtime**: 1.25.1 `onnxruntime-linux-x64` CPU build, archive sha256
  `eb566a49cfc49ef0642f809b69340b5bb656c7c4905ba873526d226f2c005816`.
- **Base images**: `debian:trixie-slim` and `golang:1.27.3-trixie` by digest.

Bump a pin and its checksum together. The image is x86-64 only.

## Licenses and attribution

- **Parakeet TDT 0.6B v3** model weights by NVIDIA, licensed under
  [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
  ([model card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)). The
  official checkpoint was exported to ONNX and quantized to int8 by the
  `achetronic/parakeet` project; Voxen redistributes those files unmodified.
  The notice ships at `/usr/share/licenses/parakeet-tdt-0.6b-v3/NOTICE`.
- **`achetronic/parakeet` server**: Apache-2.0, per the `LICENSE` file at the
  pinned commit (its README says MIT; the LICENSE file is what applies). Shipped
  at `/usr/share/licenses/parakeet-server/LICENSE`.
- **ONNX Runtime**: MIT, with its third-party notices at
  `/usr/share/licenses/onnxruntime/`.
- **onnxruntime_go**: MIT, and the **Go standard library**: BSD-3-Clause, both
  statically linked; their licenses ship in `/usr/share/licenses/onnxruntime_go`
  and `/usr/share/licenses/go`. The healthcheck binary is Voxen code.

No ffmpeg, diarization model (Nemotron, openmdw license) or Silero VAD is
included.
