/**
 * Propuestas producto → cartucho desde los consumibles de Odoo (#56).
 *
 * El mismo trabajo que `pnpm cartuchos:importar` (scripts/importar-propuestas-cartuchos.ts),
 * pero DENTRO de la imagen del middleware. El script de `scripts/` no entra en el
 * contenedor —el Dockerfile solo copia `apps/middleware`—, así que en producción
 * no había forma de ejecutarlo:
 *
 *   node dist/cli/importar-propuestas.js
 *
 * Solo lee de Odoo; en MySQL solo crea lo que falta. Se puede repetir.
 */
import { searchRead } from '../odoo/client.js';
import { prisma } from '../config/prisma.js';
import { importarPropuestas, type ProductoOdoo } from '../services/recomendador/importarPropuestas.js';

const CATEGORIA_CONSUMIBLES = 2614;

async function main(): Promise<void> {
  const productos = await searchRead<ProductoOdoo>(
    'product.template',
    [['sale_ok', '=', true], ['categ_id', 'child_of', CATEGORIA_CONSUMIBLES]],
    ['name', 'default_code'],
  );
  const r = await importarPropuestas(productos);
  console.log(
    [
      `${r.productos} productos de CONSUMIBLES (${r.sinCandidato} sin candidato: captura manual)`,
      `marcas creadas:      ${r.marcasCreadas}`,
      `cartuchos creados:   ${r.cartuchosCreados}`,
      `propuestas creadas:  ${r.propuestasCreadas}`,
      `ya existían:         ${r.propuestasExistentes} (no se tocaron)`,
    ].join('\n'),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
