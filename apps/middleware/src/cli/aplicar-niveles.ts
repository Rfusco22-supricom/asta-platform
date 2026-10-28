/**
 * El nivel de cada cuenta de cliente desde el programa de ASTA: el de su último
 * trimestre cerrado (antes del primero, su categoría al empezar el programa).
 *
 * En desarrollo:
 *
 *   pnpm --filter @asta/middleware exec tsx src/cli/aplicar-niveles.ts             SIMULACRO
 *   pnpm --filter @asta/middleware exec tsx src/cli/aplicar-niveles.ts --aplicar   escribe
 *
 * Dentro del contenedor:
 *
 *   node dist/cli/aplicar-niveles.js [--aplicar]
 *
 * Lo mismo que hace el propio middleware una vez al día (`NIVELES_INTERNOS`), y
 * lo que hace `cerrar-trimestre` al cerrar. Sirve para ver qué cambiaría, y para
 * no esperar al día siguiente.
 */
import { prisma } from '../config/prisma.js';
import { aplicarNiveles } from '../services/nivelesCliente.service.js';

async function main(): Promise<void> {
  const aplicar = process.argv.includes('--aplicar');
  console.log(`\n  Niveles de cliente desde el programa de ASTA${aplicar ? ' — APLICANDO' : ' — SIMULACRO (nada se escribe)'}\n`);

  const r = await aplicarNiveles({ aplicar });

  console.log(`  ${String(r.cuentas).padStart(6)}  cuentas de cliente`);
  for (const [nivel, n] of Object.entries(r.porNivel)) console.log(`  ${String(n).padStart(6)}  ${nivel}`);
  console.log(`\n  ${String(r.cambios).padStart(6)}  ${aplicar ? 'cambiaron' : 'cambiarían'} de nivel`);
  for (const [mov, n] of Object.entries(r.movimientos).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${mov}`);
  if (!aplicar) console.log('\n  Nada se ha escrito. Para aplicarlo: --aplicar\n');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
