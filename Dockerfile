# ============================================================================
# Voxen — Easypanel App image
# ============================================================================
# Single Easypanel image. PostgreSQL and Redis remain external; storage defaults
# to a mounted local volume and can opt into external S3/MinIO.
# O docker-compose.yml continua sendo o caminho recomendado para dev/local.
# ============================================================================

FROM node:22.23.4-alpine AS web-front-builder
WORKDIR /app

ARG VOXEN_VERSION
ARG VOXEN_GIT_SHA
ARG VOXEN_BUILT_AT
ARG GIT_SHA
ARG DEPLOY_TIMESTAMP
ENV VOXEN_VERSION=${VOXEN_VERSION:-}
ENV VOXEN_GIT_SHA=${VOXEN_GIT_SHA:-}
ENV VOXEN_BUILT_AT=${VOXEN_BUILT_AT:-}
ENV GIT_SHA=${GIT_SHA:-}
ENV DEPLOY_TIMESTAMP=${DEPLOY_TIMESTAMP:-}

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
COPY patches ./patches
COPY apps/web/package.json apps/web/
COPY packages/shared-types/package.json packages/shared-types/
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY apps/web ./apps/web
COPY packages ./packages
RUN cd apps/web && pnpm exec vite build

FROM node:22.23.4-alpine AS web-server-builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
COPY patches ./patches
COPY apps/web/package.json apps/web/
COPY packages/shared-types/package.json packages/shared-types/
RUN pnpm install --frozen-lockfile --prod --ignore-scripts && \
    find node_modules/.pnpm -maxdepth 1 -type d \
      \( -name '@esbuild+*' -o -name 'esbuild@*' -o -name 'vite@*' -o -name '@vitejs+*' -o -name '@tailwindcss+*' -o -name 'tailwindcss@*' \) \
      -exec rm -rf {} +

COPY prisma ./prisma
COPY apps/web ./apps/web
COPY packages ./packages


FROM node:22.23.4-bookworm-slim AS node-runtime
FROM oven/bun:1.4.4 AS bun-runtime

# ---------------------------------------------------------------------------
FROM python:3.13-slim AS runtime
WORKDIR /app

ARG VOXEN_VERSION
ARG VOXEN_GIT_SHA
ARG VOXEN_BUILT_AT
ENV NODE_ENV=production \
    VOXEN_VERSION=${VOXEN_VERSION:-} \
    VOXEN_GIT_SHA=${VOXEN_GIT_SHA:-} \
    VOXEN_BUILT_AT=${VOXEN_BUILT_AT:-} \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=3000 \
    STORAGE_LOCAL_PATH=/data/storage

COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun
COPY --from=bun-runtime /usr/local/bin/bunx /usr/local/bin/bunx

RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && ln -sf ../lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack \
    && apt-get update \
    && apt-get -y upgrade \
    && apt-get install -y --no-install-recommends \
      bash \
      ca-certificates \
      tini \
      wget \
    && npm install -g prisma@6.19.3 --omit=dev \
    && groupadd --system voxen \
    && useradd --system --gid voxen --uid 1001 --home-dir /app voxen \
    && mkdir -p /run/voxen /data/storage \
    && chown -R voxen:voxen /run/voxen /data/storage \
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

COPY --chown=voxen:voxen scripts/easypanel-entrypoint.sh /entrypoint.sh
COPY --chown=voxen:voxen scripts/prisma-migrate-deploy.sh /prisma-migrate-deploy.sh
RUN chmod +x /entrypoint.sh /prisma-migrate-deploy.sh

USER voxen
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD wget -qO- "http://localhost:${PORT:-3000}/health" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
