# syntax=docker/dockerfile:1
#
# voxen-proxy-agent — cliente chisel que disca pra VPS e expõe um SOCKS5 reverso.
# O egress de download (yt-dlp etc.) sai pela internet residencial onde este
# agente roda. chisel (https://github.com/jpillora/chisel) é MIT.
#
# O binário do chisel é baixado do release PINADO no GitHub e verificado por
# checksum SHA256 (reproduzível e auditável). Suporta amd64 e arm64 via
# TARGETARCH (BuildKit).

ARG CHISEL_VERSION=1.11.5

# ---------------------------------------------------------------------------
# Stage 1 — baixa e verifica o binário do chisel
# ---------------------------------------------------------------------------
FROM alpine:3.21 AS fetch

ARG CHISEL_VERSION
ARG TARGETARCH

# Checksums SHA256 dos assets oficiais do release v${CHISEL_VERSION}.
# Fonte: https://github.com/jpillora/chisel/releases/download/v1.11.5/chisel_1.11.5_checksums.txt
ARG CHISEL_SHA256_amd64=2506226c4710a3c8d3b332f83d0f3b412fe2a8436b710ea0dbec44b288ab309b
ARG CHISEL_SHA256_arm64=1a4f16aad733f022b9aa90903268d730bfb20b03f9484f7ab4863e442737fa9a

RUN set -eux; \
    apk add --no-cache curl; \
    case "${TARGETARCH:-amd64}" in \
      amd64) arch=amd64; sha="${CHISEL_SHA256_amd64}" ;; \
      arm64) arch=arm64; sha="${CHISEL_SHA256_arm64}" ;; \
      *) echo "arquitetura nao suportada: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    url="https://github.com/jpillora/chisel/releases/download/v${CHISEL_VERSION}/chisel_${CHISEL_VERSION}_linux_${arch}.gz"; \
    curl -fsSL "${url}" -o /tmp/chisel.gz; \
    echo "${sha}  /tmp/chisel.gz" | sha256sum -c -; \
    gunzip /tmp/chisel.gz; \
    chmod +x /tmp/chisel; \
    /tmp/chisel --version

# ---------------------------------------------------------------------------
# Stage 2 — runtime mínimo
# ---------------------------------------------------------------------------
FROM alpine:3.21

ARG CHISEL_VERSION
LABEL org.opencontainers.image.title="voxen-proxy-agent" \
      org.opencontainers.image.description="Cliente chisel do Voxen — SOCKS5 reverso por IP residencial" \
      org.opencontainers.image.source="https://github.com/Yefclub/Voxen" \
      org.opencontainers.image.licenses="MIT" \
      org.voxen.chisel.version="${CHISEL_VERSION}"

# ca-certificates pro TLS (wss) contra a VPS; tini como init pra encaminhar sinais.
RUN apk add --no-cache ca-certificates tini \
    && addgroup -S voxen \
    && adduser -S -G voxen -H -s /sbin/nologin voxen

COPY --from=fetch /tmp/chisel /usr/local/bin/chisel
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER voxen

# Healthcheck: confirma que o processo do chisel client está vivo.
# (O agente não escuta portas locais — o SOCKS reverso vive na VPS.)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD pgrep -x chisel >/dev/null || exit 1

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]
