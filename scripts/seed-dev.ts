import { prisma } from '../apps/middleware/src/config/prisma.js';
import { hashPassword } from '../apps/middleware/src/auth/password.js';
import { readGroup } from '../apps/middleware/src/odoo/client.js';

/** Crea un SuperAdmin y dos vendedores reales de Odoo, con contraseña conocida. */
async function main() {
  const CLAVE = 'desarrollo-local-2026';
  const hash = await hashPassword(CLAVE);

  const vendedores = await readGroup<{ user_id: [number, string]; __count: number }>(
    'res.partner',
    [['customer_rank', '>', 0], ['user_id', '!=', false], ['parent_id', '=', false]],
    [], ['user_id'],
  );
  vendedores.sort((a, b) => b.__count - a.__count);

  const crear = async (email: string, nombre: string, role: 'SUPERADMIN' | 'VENDEDOR',
                       partnerId: number, userId: number | null) => {
    const u = await prisma.appUser.upsert({
      where: { email },
      create: { email, fullName: nombre, role, odooPartnerId: partnerId, odooUserId: userId, isActive: true },
      update: { fullName: nombre, role, odooUserId: userId, isActive: true },
    });
    await prisma.userCredential.upsert({
      where: { userId: u.id },
      create: { userId: u.id, passwordHash: hash },
      update: { passwordHash: hash, failedAttempts: 0, lockedUntil: null },
    });
    console.log(`  ${role.padEnd(11)} ${email.padEnd(34)} odooUserId=${userId ?? '-'}`);
    return u;
  };

  console.log('\nUsuarios creados (contraseña: ' + CLAVE + '):\n');
  await crear('webmaster02@supricom.com.ve', 'Administrador ASTA', 'SUPERADMIN', 1, 388);
  for (const v of vendedores.slice(0, 2)) {
    const slug = v.user_id[1].toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
    await crear(`${slug}@supricom.com.ve`, v.user_id[1], 'VENDEDOR', 100000 + v.user_id[0], v.user_id[0]);
  }
  console.log('');
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
