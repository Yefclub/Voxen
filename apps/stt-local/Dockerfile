# ============================================================================
# Voxen local speech-to-text sidecar (spec 221, ADR-015). Build context:
# repository root.
#   docker compose --profile stt-local build stt-local
#
# Parakeet TDT 0.6B v3 (int8 ONNX) served by achetronic/parakeet behind an
# OpenAI-compatible /v1/audio/transcriptions endpoint. WAV input only: the
# image has no ffmpeg, no diarization model and no Silero VAD. It holds no
# secrets and needs no network egress at runtime. Every third-party artifact
# is pinned by exact version and verified by commit or checksum.
# ============================================================================

ARG DEBIAN_IMAGE=debian:trixie-slim@sha256:a72b4433de1cf7d6bae0c4cee74d0547f58601a643b3375f070c51600d63b6b2

# ---- Model: Parakeet TDT 0.6B v3 int8 ONNX (CC-BY-4.0) ----------------------
# achetronic exports the official NVIDIA checkpoint to ONNX (including the
# local-attention encoder the server loads) and ships it as an OCI image. The
# image is pinned by index digest and each file is checked again below.
FROM ghcr.io/achetronic/parakeet-models-asr-int8:v0.11.0@sha256:63f1c849817c929100c5841f02be9b36e01fc29556774f4f2c1830b50caec141 AS model-image

FROM ${DEBIAN_IMAGE} AS models
# Only the local-attention encoder is used; the full-attention one is dropped.
COPY --from=model-image /models/config.json /models/vocab.txt \
    /models/encoder-local.int8.onnx /models/decoder_joint-model.int8.onnx \
    /models/asr/int8/
RUN cd /models/asr/int8 && sha256sum -c --strict - <<'EOF'
666903c76b9798caf2c210afd4f6cd60b08a8dbf9800ec8d7a3bc0d2148ac466  config.json
d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d  vocab.txt
d30574166b233bfa376068a355642ebdf6e8531eb4d36dae1c708b6b910c2e5f  encoder-local.int8.onnx
f2ab8a752a7b356d18dcdd0eb18d0c57dec3c2fda8a35c95837bdc44fe9ea0f6  decoder_joint-model.int8.onnx
EOF

# ---- Server: achetronic/parakeet (Apache-2.0) from a pinned tag and commit --
FROM golang:1.25.14-trixie@sha256:2c4c60ef415fbfa5e90300722293bef36c5e63fae17570ce18f580af933dbd73 AS server
ARG PARAKEET_TAG=v0.11.0
ARG PARAKEET_COMMIT=28125a56bcb69e603eb731951e1657ae3a86e264
# onnxruntime_go v1.30.1 (pinned by the server's go.sum) targets the ONNX
# Runtime 1.25.x C API.
ARG ONNXRUNTIME_VERSION=1.25.1
ARG ONNXRUNTIME_SHA256=eb566a49cfc49ef0642f809b69340b5bb656c7c4905ba873526d226f2c005816
WORKDIR /src
RUN git clone --depth 1 --branch "${PARAKEET_TAG}" https://github.com/achetronic/parakeet.git . \
    && test "$(git rev-parse HEAD)" = "${PARAKEET_COMMIT}"
RUN CGO_ENABLED=1 GOFLAGS=-mod=readonly go build -trimpath -ldflags="-s -w" -o /out/parakeet . \
    && install -D -m 0644 LICENSE /out/licenses/parakeet-server/LICENSE
COPY apps/stt-local/healthcheck /healthcheck
RUN cd /healthcheck \
    && CGO_ENABLED=0 GOFLAGS=-mod=readonly go build -trimpath -ldflags="-s -w" -o /out/stt-healthcheck .
ADD --checksum=sha256:${ONNXRUNTIME_SHA256} \
    https://github.com/microsoft/onnxruntime/releases/download/v${ONNXRUNTIME_VERSION}/onnxruntime-linux-x64-${ONNXRUNTIME_VERSION}.tgz \
    /tmp/onnxruntime.tgz
# Only the CPU library is needed; the CUDA provider bridge is left out.
RUN tar -xzf /tmp/onnxruntime.tgz -C /tmp \
    && ort="/tmp/onnxruntime-linux-x64-${ONNXRUNTIME_VERSION}" \
    && install -D -m 0644 "${ort}/lib/libonnxruntime.so.${ONNXRUNTIME_VERSION}" /out/onnxruntime/libonnxruntime.so \
    && install -D -m 0644 "${ort}/LICENSE" /out/licenses/onnxruntime/LICENSE \
    && install -D -m 0644 "${ort}/ThirdPartyNotices.txt" /out/licenses/onnxruntime/ThirdPartyNotices.txt

# ---- Runtime ---------------------------------------------------------------
FROM ${DEBIAN_IMAGE} AS runtime
# Refresh Debian security fixes; bump the date when a scanner reports a fix.
ARG VOXEN_APT_SECURITY_REFRESH=2026-11-09
RUN echo "Refreshing APT security packages: ${VOXEN_APT_SECURITY_REFRESH}" \
    && apt-get update \
    && apt-get -y upgrade \
    && groupadd --system --gid 10002 stt \
    && useradd --system --uid 10002 --gid stt --home-dir /nonexistent --no-create-home stt \
    && rm -rf /var/lib/apt/lists/* \
    # Platforms that cannot set no-new-privileges or drop capabilities
    # (Easypanel, Openship) still get no setuid/setgid escalation path.
    && find / -xdev -type f -perm /6000 -exec chmod a-s {} +

COPY --from=server /out/parakeet /out/stt-healthcheck /usr/local/bin/
COPY --from=server /out/onnxruntime/libonnxruntime.so /opt/onnxruntime/lib/libonnxruntime.so
COPY --from=server /out/licenses /usr/share/licenses/
COPY apps/stt-local/NOTICE /usr/share/licenses/parakeet-tdt-0.6b-v3/NOTICE
COPY --from=models /models /models

# Every server flag also reads a PARAKEET_* variable; flags win over env.
# Long audio is split into the upstream default 60 s windows with 15 s overlap
# (smaller windows cut peak RAM but add overlap work); without the VAD model
# the chunk boundaries fall back to mel energy. GOMEMLIMIT only bounds the Go
# heap: most memory is the ONNX Runtime arena.
ENV ONNXRUNTIME_LIB=/opt/onnxruntime/lib/libonnxruntime.so \
    GOMEMLIMIT=600MiB \
    PARAKEET_PORT=5092 \
    PARAKEET_MODELS=/models \
    PARAKEET_MODEL_PRECISION=int8 \
    PARAKEET_LOG_FORMAT=json \
    PARAKEET_LONG_AUDIO=true \
    PARAKEET_DISABLE_VAD_BASED_CHUNKING=true \
    HOME=/tmp \
    TMPDIR=/tmp

# Fail the build if a required component is missing or an unwanted one slipped in.
RUN test -s /models/asr/int8/encoder-local.int8.onnx \
    && test ! -e /models/diarization && test ! -e /models/vad \
    && ! command -v ffmpeg \
    && test -x /usr/local/bin/stt-healthcheck \
    && ! ldd /usr/local/bin/parakeet | grep -q "not found" \
    && ! ldd /opt/onnxruntime/lib/libonnxruntime.so | grep -q "not found" \
    && test -z "$(find / -xdev -type f -perm /6000 -print -quit)"

USER 10002:10002
EXPOSE 5092
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD ["/usr/local/bin/stt-healthcheck"]
# One worker (one transcription at a time) and no ffmpeg are part of the
# sidecar contract, so they are fixed here instead of left to the environment.
ENTRYPOINT ["/usr/local/bin/parakeet", "-workers=1", "-ffmpeg=false", "-enable-diarization=false"]
