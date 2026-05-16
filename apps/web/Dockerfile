# ============================================================================
# Voxen Web — multi-stage Dockerfile
# ============================================================================
# Stage `build`: instala APENAS deps de produção (--prod). Sem vite/esbuild/
#   eslint/typescript no image final — reduz tamanho e elimina CVEs em devDeps
#   que não rodam em produção (esbuild gobinary trazendo Go stdlib antigo etc.)
# Stage `runtime`: bun:1.3-alpine; USER non-root; prisma generate + migrate
#   deploy no entrypoint.
# ============================================================================

FROM node:22-alpine AS build
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Deps prod apenas. --ignore-scripts evita postinstall do @prisma/client
# tentar `pnpm add prisma` em workspace (que falha em frozen-lockfile).
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/shared-types/package.json packages/shared-types/
RUN pnpm install --frozen-lockfile --prod --ignore-scripts && \
    # pnpm --prod pula symlinks de devDeps mas mantém binários no .pnpm/ store.
    # Trivy scaneia o store inteiro → removemos manualmente os binários Go
    # de devDeps que não rodam em runtime (esbuild, vite tooling).
    find node_modules/.pnpm -maxdepth 1 -type d \
      \( -name '@esbuild+*' -o -name 'esbuild@*' -o -name 'vite@*' -o -name '@vitejs+*' \) \
      -exec rm -rf {} +

# Código + schema
COPY prisma ./prisma
COPY apps/web ./apps/web
COPY packages ./packages

# Prisma client é gerado em runtime pelo entrypoint (junto com `migrate deploy`).

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
