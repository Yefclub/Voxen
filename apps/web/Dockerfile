# ============================================================================
# Voxen Web — multi-stage Dockerfile
# ============================================================================
# Stage 1 (deps): instala deps via pnpm com cache leve
# Stage 2 (build): copia código, gera prisma client, build do Vite (quando existir)
# Stage 3 (runtime): copia node_modules + dist; entrypoint roda prisma migrate deploy
# ============================================================================

FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/shared-types/package.json packages/shared-types/
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web ./apps/web
COPY packages ./packages
COPY prisma ./prisma
RUN pnpm --filter @voxen/web exec prisma generate --schema=/app/prisma/schema.prisma
# TODO: build do Vite quando o front existir
# RUN pnpm --filter @voxen/web run build

FROM oven/bun:1.2-alpine AS runtime
WORKDIR /app

# Node (Prisma CLI precisa) e wget (healthcheck)
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
