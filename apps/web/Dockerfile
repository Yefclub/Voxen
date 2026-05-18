# ============================================================================
# Voxen Web — multi-stage Dockerfile
# ============================================================================
# Stage `build-front`: instala TODAS as deps (inclui vite/tailwind) e roda
#   `vite build` pra gerar `dist/` com assets. Esta stage é descartada.
# Stage `build-server`: instala APENAS prod deps. Trivy scaneia o store; sem
#   devDeps significa sem CVEs em ferramentas de build.
# Stage `runtime`: bun:1.3-alpine; USER non-root; prisma generate + migrate
#   deploy no entrypoint. Inclui `dist/` do `build-front`.
# ============================================================================

FROM node:22-alpine AS build-front
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Workspace skeleton + deps completas (com vite/tailwind/eslint pra buildar)
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/shared-types/package.json packages/shared-types/
RUN pnpm install --frozen-lockfile --ignore-scripts

# Código do app (server + cliente)
COPY apps/web ./apps/web
COPY packages ./packages

# Build do front → apps/web/dist
RUN cd apps/web && pnpm exec vite build

FROM node:22-alpine AS build-server
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/shared-types/package.json packages/shared-types/
RUN pnpm install --frozen-lockfile --prod --ignore-scripts && \
    find node_modules/.pnpm -maxdepth 1 -type d \
      \( -name '@esbuild+*' -o -name 'esbuild@*' -o -name 'vite@*' -o -name '@vitejs+*' -o -name '@tailwindcss+*' -o -name 'tailwindcss@*' \) \
      -exec rm -rf {} +

# Server source + prisma
COPY prisma ./prisma
COPY apps/web ./apps/web
COPY packages ./packages

FROM oven/bun:1.3-alpine AS runtime
WORKDIR /app

# Build args injetados pelo CI/Compose pra mostrar versão no /api/version e
# no footer da UI. Não-blocking (default vai pro env do servidor).
ARG VOXEN_VERSION
ARG VOXEN_GIT_SHA
ARG VOXEN_BUILT_AT
ENV VOXEN_VERSION=${VOXEN_VERSION:-0.1.0}
ENV VOXEN_GIT_SHA=${VOXEN_GIT_SHA:-}
ENV VOXEN_BUILT_AT=${VOXEN_BUILT_AT:-}

RUN apk add --no-cache nodejs npm wget && \
    npm install -g prisma@6.19.3 --omit=dev && \
    addgroup -S voxen && adduser -S -G voxen -u 1001 voxen && \
    # Prisma 6 precisa escrever no diretório de instalação pra baixar engines
    # em runtime — dá chown pra voxen senão `prisma generate` falha.
    chown -R voxen:voxen /usr/local/lib/node_modules/prisma /usr/local/lib/node_modules/@prisma 2>/dev/null || true

COPY --from=build-server --chown=voxen:voxen /app/node_modules ./node_modules
COPY --from=build-server --chown=voxen:voxen /app/apps/web ./apps/web
COPY --from=build-server --chown=voxen:voxen /app/packages ./packages
COPY --from=build-server --chown=voxen:voxen /app/prisma ./prisma
# Assets do front (dist/) vêm do build-front
COPY --from=build-front --chown=voxen:voxen /app/apps/web/dist ./apps/web/dist
COPY --chown=voxen:voxen apps/web/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER voxen
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD wget -qO- http://localhost:3000/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]
CMD ["bun", "apps/web/src/index.ts"]
