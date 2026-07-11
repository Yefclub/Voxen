# ============================================================================
# Voxen — Easypanel App image
# ============================================================================
# Imagem única para deploy como App no Easypanel. Postgres, Redis e MinIO/S3
# devem ser serviços externos/gerenciados pelo Easypanel e configurados por env.
# O docker-compose.yml continua sendo o caminho recomendado para dev/local.
# ============================================================================

FROM node:22-alpine AS web-front-builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/shared-types/package.json packages/shared-types/
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY apps/web ./apps/web
COPY packages ./packages
RUN cd apps/web && pnpm exec vite build

FROM node:22-alpine AS web-server-builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/shared-types/package.json packages/shared-types/
RUN pnpm install --frozen-lockfile --prod --ignore-scripts && \
    find node_modules/.pnpm -maxdepth 1 -type d \
      \( -name '@esbuild+*' -o -name 'esbuild@*' -o -name 'vite@*' -o -name '@vitejs+*' -o -name '@tailwindcss+*' -o -name 'tailwindcss@*' \) \
      -exec rm -rf {} +

COPY prisma ./prisma
COPY apps/web ./apps/web
COPY packages ./packages


FROM python:3.13-slim AS worker-builder
WORKDIR /app/apps/worker

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

COPY apps/worker/pyproject.toml ./
COPY apps/worker/uv.lock* ./
RUN uv sync --frozen --no-install-project || uv sync --no-install-project

COPY apps/worker/src ./src
RUN uv sync --frozen --no-editable || uv sync --no-editable

FROM node:22-bookworm-slim AS node-runtime
FROM oven/bun:1.3 AS bun-runtime

# ---------------------------------------------------------------------------
# chisel — servidor de túnel reverso embutido na imagem combinada.
# Binário PINADO do release oficial, verificado por SHA256 (mesmos checksums
# usados em apps/proxy-agent/Dockerfile). Multi-arch via TARGETARCH (BuildKit).
# chisel (https://github.com/jpillora/chisel) é MIT.
# ---------------------------------------------------------------------------
FROM debian:bookworm-slim AS chisel-fetch

ARG CHISEL_VERSION=1.11.5
ARG TARGETARCH
# Checksums SHA256 dos assets oficiais do release v${CHISEL_VERSION}.
# Fonte: https://github.com/jpillora/chisel/releases/download/v1.11.5/chisel_1.11.5_checksums.txt
ARG CHISEL_SHA256_amd64=2506226c4710a3c8d3b332f83d0f3b412fe2a8436b710ea0dbec44b288ab309b
ARG CHISEL_SHA256_arm64=1a4f16aad733f022b9aa90903268d730bfb20b03f9484f7ab4863e442737fa9a

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl; \
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
    /tmp/chisel --version; \
    rm -rf /var/lib/apt/lists/*

FROM python:3.13-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=3000 \
    S3_REGION=us-east-1 \
    S3_FORCE_PATH_STYLE=true \
    DENO_DIR=/tmp/voxen-deno \
    CHISEL_PORT=8088 \
    CHISEL_AUTHFILE=/run/voxen/chisel-auth.json \
    CHISEL_PIDFILE=/run/voxen/chisel.pid

COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun
COPY --from=bun-runtime /usr/local/bin/bunx /usr/local/bin/bunx
COPY --from=chisel-fetch /tmp/chisel /usr/local/bin/chisel

RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && ln -sf ../lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack \
    && apt-get update \
    && apt-get -y upgrade \
    && apt-get install -y --no-install-recommends \
      bash \
      ca-certificates \
      ffmpeg \
      tini \
      wget \
    && npm install -g prisma@6.19.3 --omit=dev \
    && groupadd --system voxen \
    && useradd --system --gid voxen --uid 1001 --home-dir /app voxen \
    && mkdir -p /run/voxen \
    && chown -R voxen:voxen /run/voxen \
    && chmod 700 /run/voxen \
    && rm -rf /var/lib/apt/lists/* \
    && (chown -R voxen:voxen /app /usr/local/lib/node_modules/prisma /usr/local/lib/node_modules/@prisma 2>/dev/null || true)

COPY --from=web-server-builder --chown=voxen:voxen /app/node_modules ./node_modules
COPY --from=web-server-builder --chown=voxen:voxen /app/apps/web ./apps/web
COPY --from=web-server-builder --chown=voxen:voxen /app/packages ./packages
COPY --from=web-server-builder --chown=voxen:voxen /app/prisma ./prisma
COPY --from=web-front-builder --chown=voxen:voxen /app/apps/web/dist ./apps/web/dist
# Changelog manifesto (página Novidades)
COPY --chown=voxen:voxen releases.json ./releases.json

COPY --from=worker-builder --chown=voxen:voxen /app/apps/worker/.venv ./apps/worker/.venv
COPY --from=worker-builder --chown=voxen:voxen /app/apps/worker/src ./apps/worker/src

COPY --chown=voxen:voxen scripts/easypanel-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Mantem a imagem unica alinhada ao worker do Compose: yt-dlp atual precisa de
# EJS + runtime JS para alguns fluxos do YouTube.
RUN /app/apps/worker/.venv/bin/deno --version >/dev/null \
    && /app/apps/worker/.venv/bin/python -m yt_dlp --version >/dev/null

USER voxen
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD wget -qO- "http://localhost:${PORT:-3000}/health" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
