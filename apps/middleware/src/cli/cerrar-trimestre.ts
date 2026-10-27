/**
 * El programa de ASTA por trimestres: ver cómo va un trimestre y cerrarlo.
 *
 * En desarrollo:
 *
 *   pnpm --filter @asta/middleware exec tsx src/cli/cerrar-trimestre.ts [2026-Q4]             SIMULACRO
 *   pnpm --filter @asta/middleware exec tsx src/cli/cerrar-trimestre.ts [2026-Q4] --aplicar   CIERRA
 *
 * Dentro del contenedor:
 *
 *   node dist/cli/cerrar-trimestre.js [2026-Q4] [--aplicar]
 *
 * Sin trimestre, el que acaba de terminar. El simulacro se puede lanzar en
 * cualquier momento, también con el trimestre en curso: dice cómo cerraría si
 * terminara hoy. Cerrar, solo cuando ya no puede cambiar (desde el día 11 del
 * mes siguiente a su último mes, cuando vence el plazo del sell-out), y una
 * vez. Al cerrar, pone en las cuentas el nivel nuevo (`aplicarNiveles`).
 */
import { VARIEDAD, nombreTrimestre, reglaDe, trimestreAnterior, trimestreDe, trimestreSchema, type ClaveCategoria } from '@asta/shared-types';
import { prisma } from '../config/prisma.js';
import { aplicarNiveles } from '../services/nivelesCliente.service.js';
import { CierreNoPermitido, cerrarTrimestre, evaluarTrimestre, resumir, type ResumenCierre } from '../services/programaAsta.service.js';

const n = (x: number) => String(x).padStart(6);

function imprimir(r: ResumenCierre): void {
  console.log(`  ${n(r.clientes)}  clientes en el programa`);
  console.log(`  ${n(r.suben)}  suben un nivel`);
  console.log(`  ${n(r.bajan)}  bajan un nivel`);
  console.log(`  ${n(r.seQuedan)}  se quedan (Diamante que cumple, o Cliente general que no)`);
  console.log(`  ${n(r.tokens)}  tokens repartidos\n`);
  console.log('  Cumplen:');
  console.log(`  ${n(r.cumplen.mensual)}  la cuota mensual los tres meses`);
  console.log(`  ${n(r.cumplen.trimestral)}  la cuota trimestral`);
  console.log(`  ${n(r.cumplen.sellout)}  el sell-out de los tres meses`);
  console.log(`  ${n(r.cumplen.excedente)}  el excedente`);
  console.log(`  ${n(r.cumplen.racha)}  la racha`);
  console.log(`  ${n(r.cumplen.variedad)}  la variedad (${Math.ceil(r.referenciasTotal * VARIEDAD)} de ${r.referenciasTotal} referencias ASTA)\n`);
  console.log('  Acaban en:');
  for (const [nivel, cuantos] of Object.entries(r.porNivel).reverse()) console.log(`  ${n(cuantos)}  ${reglaDe(nivel as ClaveCategoria).nombre}`);
}

async function main(): Promise<void> {
  const aplicar = process.argv.includes('--aplicar');
  const argumento = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const trimestre = argumento ?? trimestreAnterior(trimestreDe(new Date()));
  if (!trimestreSchema.safeParse(trimestre).success) throw new Error(`«${trimestre}» no es un trimestre: escríbelo como 2026-Q4.`);

  console.log(`\n  Programa ASTA · ${nombreTrimestre(trimestre)} (${trimestre})${aplicar ? ' — CERRANDO' : ' — SIMULACRO (nada se escribe)'}\n`);

  if (!aplicar) {
    const clientes = await evaluarTrimestre(trimestre);
    if (clientes.some((c) => !c.evaluacion.definitiva)) console.log('  El trimestre no ha terminado: así cerraría si terminara hoy.\n');
    imprimir(resumir(trimestre, clientes));
    console.log('\n  Nada se ha escrito. Para cerrarlo: --aplicar\n');
    return;
  }

  try {
    imprimir(await cerrarTrimestre(trimestre, { aplicar: true }));
  } catch (error) {
    if (error instanceof CierreNoPermitido) {
      console.log(`  ${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
  const niveles = await aplicarNiveles({ aplicar: true });
  console.log(`\n  Cuentas: ${niveles.cambios} cambiaron de nivel`);
  for (const [mov, cuantos] of Object.entries(niveles.movimientos).sort((a, b) => b[1] - a[1])) console.log(`  ${n(cuantos)}  ${mov}`);
  console.log('\n  Cerrado. El trimestre ya no se puede volver a cerrar.\n');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
