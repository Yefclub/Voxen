# ============================================================================
# Voxen Web — multi-stage Dockerfile
# ============================================================================
# Stage `build`: instala deps via pnpm (sem postinstall — evita prisma auto-install)
# Stage `runtime`: bun:1.3-alpine; prisma generate + migrate deploy no entrypoint
# Roda como usuário non-root (voxen, uid 1001) por segurança (DS-0002).
# ============================================================================

FROM node:22-alpine AS build
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Deps (cache-friendly). --ignore-scripts evita postinstall do @prisma/client
# tentar `pnpm add prisma` em workspace (que falha em frozen-lockfile).
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/shared-types/package.json packages/shared-types/
RUN pnpm install --frozen-lockfile --ignore-scripts

# Código + schema
COPY prisma ./prisma
COPY apps/web ./apps/web
COPY packages ./packages

# Prisma client é gerado em runtime pelo entrypoint (junto com `migrate deploy`).
# Não rodamos `prisma generate` aqui pra evitar quirks de workspace + auto-install.

FROM oven/bun:1.3-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache nodejs npm wget && \
    npm install -g prisma@6.19.3 --omit=dev && \
    addgroup -S voxen && adduser -S -G voxen -u 1001 voxen

COPY --from=build --chown=voxen:voxen /app/node_modules ./node_modules
COPY --from=build --chown=voxen:voxen /app/apps/web ./apps/web
COPY --from=build --chown=voxen:voxen /app/packages ./packages
COPY --from=build --chown=voxen:voxen /app/prisma ./prisma
COPY --chown=voxen:voxen apps/web/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER voxen
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD wget -qO- http://localhost:3000/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]
CMD ["bun", "apps/web/src/index.ts"]
