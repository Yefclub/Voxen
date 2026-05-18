// ============================================================================
// Voxen — Reset de senha via CLI (admin operations)
// ============================================================================
// Uso: bun apps/web/src/scripts/reset-password.ts <email> <nova-senha>
//
// Voxen NÃO tem SMTP / reset por email (decisão de design — self-hosted
// single-tenant). Quando um user esquece a senha, o owner do deploy roda
// este script via SSH no servidor.
//
// O script:
// 1. Localiza o User pelo email
// 2. Gera hash da nova senha via better-auth (mesmo algoritmo que /sign-up usa)
// 3. Atualiza Account.password (credential do provider 'credential')
// 4. Revoga todas as sessões existentes do user (security)
//
// Requer: DATABASE_URL e BETTER_AUTH_SECRET no env (já vêm via compose).
// ============================================================================

import { hashPassword } from 'better-auth/crypto';
import { db } from '../lib/db';

async function main(): Promise<void> {
  const [, , email, passwordArg] = process.argv;
  // Senha pode vir por arg OR env var VOXEN_NEW_PASSWORD (anti shell history).
  // Recomendado em prod: usar env var pra não vazar em `ps`/.bash_history.
  const newPassword = passwordArg ?? process.env.VOXEN_NEW_PASSWORD;

  if (!email || !newPassword) {
    console.error('Uso:');
    console.error('  Recomendado (sem expor senha em ps/history):');
    console.error('    VOXEN_NEW_PASSWORD="novaSenha12chars" \\');
    console.error('      bun apps/web/src/scripts/reset-password.ts <email>');
    console.error('');
    console.error('  Direto (senha em arg — exposta no `ps` e shell history):');
    console.error('    bun apps/web/src/scripts/reset-password.ts <email> <nova-senha>');
    console.error('');
    console.error('Via Make:');
    console.error('  make reset-password EMAIL=user@exemplo.com PASSWORD="senha12chars"');
    process.exit(2);
  }

  if (newPassword.length < 12) {
    console.error('Erro: senha mínima de 12 caracteres.');
    process.exit(2);
  }

  // 1. Localiza user
  const user = await db.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true, email: true, name: true },
  });
  if (!user) {
    console.error(`Erro: nenhum user com email "${email}".`);
    process.exit(1);
  }

  // 2. Localiza credential account (better-auth usa providerId='credential' pra email/senha)
  const account = await db.account.findFirst({
    where: { userId: user.id, providerId: 'credential' },
    select: { id: true },
  });
  if (!account) {
    console.error(`Erro: user "${email}" não tem credential account (talvez login social only?).`);
    process.exit(1);
  }

  // 3. Hash com algoritmo do better-auth (scrypt — mesmo do /sign-up)
  const hash = await hashPassword(newPassword);

  // 4. Atualiza Account.password
  await db.account.update({
    where: { id: account.id },
    data: { password: hash, updatedAt: new Date() },
  });

  // 5. Revoga TODAS as sessões existentes (security: senha trocada → logout forçado)
  const deletedSessions = await db.session.deleteMany({
    where: { userId: user.id },
  });

  // console.warn é permitido pelo eslint (precisamos stdout no CLI)
  console.warn(`✓ Senha do user "${user.email}" (${user.name}) resetada.`);
  console.warn(`  ${deletedSessions.count} sessão(ões) ativa(s) revogada(s).`);
  console.warn('  Próximo login: senha nova.');
}

main()
  .catch((err) => {
    console.error('Erro ao resetar senha:', err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => {
    void db.$disconnect();
  });
