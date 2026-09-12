// ============================================================================
// Voxen — Prisma client singleton
// ============================================================================
// Em Bun runtime, módulo top-level só roda uma vez por processo — singleton
// natural. Reusamos em todo o app (auth, routes, services) pra evitar
// múltiplas conexões.
// ============================================================================

// Prisma client gerado em apps/web/prisma-generated/ pelo generator
// `prisma-client` (v6). Output dentro do package pra resolver
// `@prisma/client/runtime/library` via apps/web/node_modules/.
import { PrismaClient } from '../../prisma-generated/client';

// Prisma's stdout/stderr logger includes multi-line call sites and provider
// messages. Errors are handled at request/background boundaries, where Voxen
// emits bounded structured diagnostics instead.
export const db = new PrismaClient();
