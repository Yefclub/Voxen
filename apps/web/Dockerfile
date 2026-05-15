# ============================================================================
# Voxen Web — multi-stage Dockerfile
# ============================================================================
# Stage `build`: instala deps via pnpm, gera Prisma Client (prisma global)
# Stage `runtime`: bun:1.2-alpine + Prisma CLI p/ migrate deploy no entrypoint
# ============================================================================

FROM node:22-alpine AS build
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
RUN npm install -g prisma@6

# Deps (cache-friendly)
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/shared-types/package.json packages/shared-types/
RUN pnpm install --frozen-lockfile

# Código + schema
COPY prisma ./prisma
COPY apps/web ./apps/web
COPY packages ./packages

# Prisma generate via CLI global (evita workspace-resolution drama)
RUN prisma generate --schema=/app/prisma/schema.prisma

# TODO: build do Vite quando o front existir
# RUN cd apps/web && pnpm run build

FROM oven/bun:1.2-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache nodejs npm wget && \
    npm install -g prisma@6 --omit=dev

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/web ./apps/web
COPY --from=build /app/packages ./packages
COPY --from=build /app/prisma ./prisma
COPY apps/web/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD wget -qO- http://localhost:3000/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]
CMD ["bun", "apps/web/src/index.ts"]
