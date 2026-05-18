// ============================================================================
// Voxen Prisma seed — placeholder
// ============================================================================
// Por design o seed em produção é VAZIO: o primeiro user que se cadastrar
// vira admin (lógica em apps/web/src). Este arquivo existe pra:
//   - validar que o pipeline `pnpm prisma db seed` funciona
//   - hospedar seed de DEV no futuro (ex: criar admin fixture pra E2E)
//
// Em prod (Easypanel): NÃO rodar seed — fluxo natural cria o admin via UI.
// ============================================================================

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const userCount = await prisma.user.count();
  console.warn(`[seed] users existentes: ${userCount}`);
  console.warn('[seed] sem seed por design — primeiro cadastro via UI vira admin.');
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
