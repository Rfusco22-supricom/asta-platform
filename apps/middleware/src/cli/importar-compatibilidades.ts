/**
 * Carga `compatibilidad_productos` en las tablas del recomendador (#56).
 *
 * En desarrollo:
 *
 *   pnpm compatibilidades:importar             SIMULACRO: dice qué haría y no escribe
 *   pnpm compatibilidades:importar --aplicar   escribe
 *
 * Dentro del contenedor del middleware:
 *
 *   node dist/cli/importar-compatibilidades.js [--aplicar]
 *
 * Todo entra como PROPUESTA y se revisa en el panel, en Compatibilidades →
 * Impresoras. Se puede repetir: nunca pisa lo ya revisado. Ver
 * `importarCompatibilidades.ts`.
 *
 * Va DESPUÉS de `importar-propuestas`: así los códigos de la tabla cruzan con los
 * cartuchos que ya se sacaron de los productos de Odoo, en vez de duplicarlos.
 */
import { prisma } from '../config/prisma.js';
import { importarCompatibilidades } from '../services/recomendador/importarCompatibilidades.js';

const n = (x: number) => String(x).padStart(5);

async function main(): Promise<void> {
  const aplicar = process.argv.includes('--aplicar');
  console.log(`\n  compatibilidad_productos → recomendador${aplicar ? ' — APLICANDO' : ' — SIMULACRO (nada se escribe)'}\n`);

  const filas = await prisma.compatibilidadProducto.findMany({ orderBy: { id: 'asc' } });
  const r = await importarCompatibilidades(filas, { aplicar });
  const v = (hecho: string, futuro: string) => (aplicar ? hecho : futuro);

  console.log(`  ${n(r.filas)}  filas leídas`);
  console.log(`  ${n(r.cartuchosQueCruzan)}  códigos que cruzan con un cartucho de Odoo`);
  console.log(`  ${n(r.cartuchosCreados)}  cartuchos ${v('creados', 'se crearían')} (sin producto en Odoo o con errata)`);
  console.log(`  ${n(r.marcasCreadas)}  marcas ${v('creadas', 'se crearían')}`);
  console.log(`  ${n(r.modelosCreados)}  modelos de impresora ${v('creados', 'se crearían')}`);
  console.log(`  ${n(r.compatibilidadesCreadas)}  compatibilidades ${v('creadas', 'se crearían')} como PROPUESTA`);
  console.log(`  ${n(r.compatibilidadesExistentes)}  ya existían (no se tocan)`);
  console.log(`  ${n(r.rendimientosRellenados)}  rendimientos ${v('rellenados', 'se rellenarían')}, ${r.coloresRellenados} colores`);

  if (r.codigosSinCruce.length) {
    console.log('\n  Códigos sin cartucho previo — revisa si es una errata en la tabla:');
    for (const c of r.codigosSinCruce) console.log(`    #${c.id}  ${c.code}`);
  }
  if (r.sinModelos.length) {
    console.log('\n  Filas de las que no salió ningún modelo — corrige el texto en la tabla:');
    for (const s of r.sinModelos) console.log(`    #${s.id}  ${s.code}  «${s.modelo}»`);
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
