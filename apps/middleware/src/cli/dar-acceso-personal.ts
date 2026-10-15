/**
 * Da acceso al panel a alguien del personal que no es vendedor (#81).
 *
 * Dentro del contenedor del middleware:
 *
 *   node dist/cli/dar-acceso-personal.js --login nombre.apellido@supricom.com --rol SUPERADMIN             SIMULACRO
 *   node dist/cli/dar-acceso-personal.js --login nombre.apellido@supricom.com --rol SUPERADMIN --aplicar   escribe
 *
 * Entra con su usuario y contraseña de Odoo. Simulacro por defecto, como
 * `sync-vendedores`: un SUPERADMIN lo ve y lo cambia todo, y eso se lee antes de
 * concederlo. Ver `accesoPersonal.service.ts`.
 */
import '../config/dotenv.js';
import { prisma } from '../config/prisma.js';
import { AccesoImposible, darAccesoPersonal, type RolPersonal } from '../services/accesoPersonal.service.js';
import { esperarAuditoriaPendiente, installAuditSinks } from '../services/audit.service.js';

const arg = (nombre: string) => {
  const i = process.argv.indexOf(nombre);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main(): Promise<void> {
  installAuditSinks();
  const login = arg('--login');
  const rol = arg('--rol');
  const aplicar = process.argv.includes('--aplicar');
  if (!login || (rol !== 'SUPERADMIN' && rol !== 'VENDEDOR')) {
    console.error('Uso: dar-acceso-personal --login <login de Odoo> --rol SUPERADMIN|VENDEDOR [--aplicar]');
    process.exitCode = 2;
    return;
  }

  console.log(`\n  acceso al panel${aplicar ? ' — APLICANDO' : ' — SIMULACRO (nada se escribe)'}\n`);
  try {
    const r = await darAccesoPersonal({ login, rol: rol as RolPersonal, aplicar });
    const v = (hecho: string, futuro: string) => (aplicar ? hecho : futuro);
    if (r.tipo === 'crear') console.log(`  ${r.nombre} (${r.email}) · cuenta ${v('creada', 'que se crearía')} como ${r.rol}, atada al usuario ${r.odooUserId} de Odoo.`);
    else if (r.tipo === 'cambiar') console.log(`  ${r.nombre} (${r.email}) · ${r.cambios.join(', ')}${aplicar ? '' : ' (se aplicaría)'}.`);
    else console.log(`  ${r.nombre} (${r.email}) ya es ${r.rol} y está atada a Odoo: nada que hacer.`);
    if (r.tipo !== 'igual') {
      console.log(aplicar ? '\n  Ya puede entrar al panel con su usuario y contraseña de Odoo.\n' : '\n  Nada se ha escrito. Para aplicarlo: --aplicar\n');
    }
  } catch (error) {
    if (!(error instanceof AccesoImposible)) throw error;
    console.error(`  No se puede: ${error.message}\n`);
    process.exitCode = 1;
  }
  await esperarAuditoriaPendiente();
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
