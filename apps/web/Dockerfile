FROM oven/bun:1.2-alpine AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY prisma ./prisma
RUN bun install --frozen-lockfile || bun install

FROM deps AS build
WORKDIR /app
COPY apps/web ./apps/web
WORKDIR /app/apps/web
RUN bunx prisma generate --schema=/app/prisma/schema.prisma
RUN bun run build || echo "TODO: build front quando existir"

FROM oven/bun:1.2-alpine AS runtime
WORKDIR /app

# Prisma CLI precisa de Node em runtime pra `migrate deploy`
RUN apk add --no-cache nodejs npm wget && npm install -g prisma@6

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/web ./apps/web
COPY --from=build /app/prisma ./prisma
COPY apps/web/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD wget -qO- http://localhost:3000/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]
CMD ["bun", "apps/web/src/index.ts"]
