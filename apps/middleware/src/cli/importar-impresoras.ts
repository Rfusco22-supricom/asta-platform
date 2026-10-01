/**
 * Carga modelos de impresora leyendo los nombres de los productos de Odoo (#129).
 *
 * En desarrollo:
 *
 *   pnpm impresoras:importar             SIMULACRO: dice qué haría y no escribe
 *   pnpm impresoras:importar --aplicar   escribe
 *
 * Dentro del contenedor del middleware:
 *
 *   node dist/cli/importar-impresoras.js [--aplicar]
 *
 * Va DESPUÉS de `importar-propuestas`: ata las impresoras del nombre con los
 * cartuchos que ese importador sacó del mismo producto, así que sin él no hay
 * nada que atar.
 *
 * Todo entra como PROPUESTA y se revisa en el panel, en Compatibilidades →
 * Impresoras. Se puede repetir: nunca pisa lo ya revisado.
 */
import { prisma } from '../config/prisma.js';
import { searchRead } from '../odoo/client.js';
import { importarImpresorasDeNombres } from '../services/recomendador/importarImpresorasDeNombres.js';

/** La categoría de consumibles de esta instancia, la misma que usan los otros importadores. */
const CATEGORIA_CONSUMIBLES = 2614;

const n = (x: number) => String(x).padStart(5);

async function main(): Promise<void> {
  const aplicar = process.argv.includes('--aplicar');
  console.log(`\n  nombres de Odoo → impresoras${aplicar ? ' — APLICANDO' : ' — SIMULACRO (nada se escribe)'}\n`);

  const productos = await searchRead<{ id: number; name: string }>(
    'product.template',
    [['categ_id', 'child_of', CATEGORIA_CONSUMIBLES]],
    ['name'],
    // Las archivadas también: su cartucho sigue vendiéndose en otro producto, y
    // la impresora que nombran sigue existiendo en casa del cliente.
    { context: { active_test: false } },
  );

  const r = await importarImpresorasDeNombres(productos, { aplicar });
  const v = (hecho: string, futuro: string) => (aplicar ? hecho : futuro);

  console.log(`  ${n(r.productos)}  productos leídos`);
  console.log(`  ${n(r.conImpresoras)}  con impresoras en el nombre`);
  console.log(`  ${n(r.sinCartucho)}  de esos, sin ningún cartucho todavía (pasa antes importar-propuestas)`);
  console.log(`  ${n(r.marcasCreadas)}  marcas ${v('creadas', 'se crearían')}`);
  console.log(`  ${n(r.modelosCreados)}  modelos de impresora ${v('creados', 'se crearían')}`);
  console.log(`  ${n(r.modelosRepetidos)}  modelos que ya estaban, o que repite otro producto`);
  console.log(`  ${n(r.compatibilidadesCreadas)}  compatibilidades ${v('creadas', 'se crearían')} como PROPUESTA`);
  console.log(`  ${n(r.compatibilidadesExistentes)}  ya existían (no se tocan)`);

  if (r.conVariosCartuchos) {
    console.log(
      `\n  ${r.conVariosCartuchos} productos listan varios cartuchos: se propone cada cartucho con\n` +
        '  cada impresora, y la nota lo dice. Son las propuestas que hay que mirar despacio.',
    );
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
