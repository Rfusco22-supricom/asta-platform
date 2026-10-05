/**
 * Lleva a MySQL las decisiones de un CSV de propuestas revisado (#56).
 *
 * En desarrollo:
 *
 *   pnpm cartuchos:validar --archivo revisado.csv --revisor admin@empresa.com
 *   pnpm cartuchos:validar --archivo revisado.csv --revisor admin@empresa.com --aplicar
 *
 * Dentro del contenedor del middleware, que es donde está la base de verdad:
 *
 *   node dist/cli/validar-propuestas.js --archivo /tmp/revisado.csv --revisor <email> [--aplicar]
 *
 * Sin `--aplicar` NO escribe nada: enseña qué haría con cada fila. Con errores,
 * no aplica ninguna aunque se pida. `--permitir-cambios` deja cambiar una decisión
 * ya tomada (VALIDADA ↔ RECHAZADA); sin él, eso es un error.
 *
 * El CSV es el de `pnpm cartuchos:proponer`, con la columna `decision` rellena
 * (VALIDADA, RECHAZADA o vacía) y `nota` opcional. Vale guardado desde Excel,
 * con `;` o con `,`. Ver `validarPropuestas.ts`.
 */
import '../config/dotenv.js';
import { readFileSync } from 'node:fs';
import { searchRead } from '../odoo/client.js';
import { prisma } from '../config/prisma.js';
import { leerCsv } from '../utils/csv.js';
import { aplicarValidacion, planificarValidacion, resolverRevisor } from '../services/recomendador/validarPropuestas.js';
import type { ProductoOdoo } from '../services/recomendador/importarPropuestas.js';

const arg = (nombre: string) => {
  const i = process.argv.indexOf(nombre);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const archivo = arg('--archivo');
const email = arg('--revisor');
const aplicar = process.argv.includes('--aplicar');
const permitirCambios = process.argv.includes('--permitir-cambios');

const salir = async (codigo: number) => {
  await prisma.$disconnect();
  process.exit(codigo);
};

async function main(): Promise<void> {
  if (!archivo || !email) {
    console.error('Uso: validar-propuestas --archivo revisado.csv --revisor <email SUPERADMIN> [--aplicar] [--permitir-cambios]');
    await salir(2);
    return;
  }
  const revisor = await resolverRevisor(email);
  const filas = leerCsv(readFileSync(archivo, 'utf8'));
  const plan = await planificarValidacion(filas, {
    permitirCambios,
    buscarProductos: (ids) => searchRead<ProductoOdoo>('product.template', [['id', 'in', ids]], ['name', 'default_code'], { context: { active_test: false } }),
  });

  const cuenta = (t: string) => plan.acciones.filter((a) => a.tipo === t).length;
  const decididas = plan.acciones.filter((a) => a.tipo === 'DECIDIR');
  console.log(
    [
      `${archivo}: ${filas.length} filas · revisor ${revisor.email}`,
      `  sin decidir:          ${plan.sinDecidir}`,
      `  a VALIDADA:           ${decididas.filter((a) => a.decision === 'VALIDADA').length}`,
      `  a RECHAZADA:          ${decididas.filter((a) => a.decision === 'RECHAZADA').length}`,
      `  captura manual:       ${cuenta('CREAR_MANUAL')}`,
      `  ya estaban así:       ${cuenta('SIN_CAMBIO')}`,
      `  avisos:               ${plan.avisos.length}`,
      `  ERRORES:              ${plan.errores.length}`,
    ].join('\n'),
  );
  for (const a of plan.avisos.slice(0, 30)) console.log(`  aviso  línea ${a.linea}: ${a.mensaje}`);
  for (const e of plan.errores.slice(0, 50)) console.log(`  ERROR  línea ${e.linea}: ${e.mensaje}`);
  if (plan.errores.length > 50) console.log(`  … y ${plan.errores.length - 50} errores más`);

  if (plan.errores.length > 0) {
    console.log('\nNo se ha aplicado nada. Corrige el archivo y vuelve a ejecutarlo.');
    await salir(1);
  }
  if (!aplicar) {
    console.log('\nNo se ha escrito nada: es una simulación. Añade --aplicar para llevarlo a la base.');
    await salir(0);
  }

  const r = await aplicarValidacion(plan, revisor);
  console.log(`\nAplicado: ${r.decididas} decididas, ${r.creadasManuales} de captura manual, ${r.sinCambio} sin cambio.`);
  await salir(0);
}

main().catch(async (e: unknown) => {
  console.error(`\n${e instanceof Error ? e.message : String(e)}`);
  await salir(1);
});
