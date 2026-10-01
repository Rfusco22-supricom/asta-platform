/**
 * Carga las listas de impresoras del fabricante en el recomendador (#56).
 *
 * En desarrollo:
 *
 *   pnpm listas:importar             SIMULACRO: dice qué haría y no escribe
 *   pnpm listas:importar --aplicar   escribe
 *
 * Dentro del contenedor del middleware:
 *
 *   node dist/cli/importar-listas-fabricante.js [--aplicar]
 *
 * Las listas están en `listasFabricante.ts`, cada una con su página oficial.
 * Todo entra como PROPUESTA y se revisa en el panel, en Compatibilidades →
 * Impresoras. Se puede repetir: nunca pisa lo ya revisado.
 *
 * Va DESPUÉS de `importar-propuestas`: solo enlaza cartuchos que ya existen.
 */
import { prisma } from '../config/prisma.js';
import { importarListasFabricante } from '../services/recomendador/importarListasFabricante.js';
import { LISTAS_FABRICANTE } from '../services/recomendador/listasFabricante.js';

const n = (x: number) => String(x).padStart(5);

async function main(): Promise<void> {
  const aplicar = process.argv.includes('--aplicar');
  console.log(`\n  listas del fabricante → recomendador${aplicar ? ' — APLICANDO' : ' — SIMULACRO (nada se escribe)'}\n`);

  const r = await importarListasFabricante(LISTAS_FABRICANTE, { aplicar });
  const v = (hecho: string, futuro: string) => (aplicar ? hecho : futuro);

  console.log(`  ${n(r.listas)}  listas`);
  console.log(`  ${n(r.cartuchosEnlazados)}  cartuchos encontrados`);
  console.log(`  ${n(r.modelosCreados)}  modelos de impresora ${v('creados', 'se crearían')}`);
  console.log(`  ${n(r.compatibilidadesCreadas)}  compatibilidades ${v('creadas', 'se crearían')} como PROPUESTA`);
  console.log(`  ${n(r.compatibilidadesExistentes)}  ya existían (no se tocan)`);

  if (r.marcasNoEncontradas.length) {
    console.log('\n  Marcas que no están en printer_brands — no se ha cargado nada de ellas:');
    for (const m of r.marcasNoEncontradas) console.log(`    ${m}`);
  }
  if (r.cartuchosNoEncontrados.length) {
    console.log('\n  Cartuchos que no existen todavía — pasa antes importar-propuestas:');
    for (const c of r.cartuchosNoEncontrados) console.log(`    ${c.marca} ${c.codigo}`);
  }
  if (!aplicar) console.log('\n  Nada se ha escrito. Para aplicarlo: --aplicar\n');
  else console.log('\n  Revisa lo importado en el panel: Compatibilidades → Impresoras.\n');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
