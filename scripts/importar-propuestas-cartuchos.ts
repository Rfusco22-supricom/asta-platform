/**
 * Carga en MySQL las propuestas "producto → cartucho" de los consumibles (#56).
 *
 *   pnpm cartuchos:importar
 *
 * Lee de Odoo (solo lectura) las plantillas de CONSUMIBLES y deja cada candidato
 * como `PROPUESTA` en `product_cartridges`. Idempotente: se puede ejecutar cada
 * vez que entren productos nuevos, y NUNCA toca una fila que ya existe —ni una
 * validada ni una rechazada—. Ver `importarPropuestas.ts`.
 *
 * Escribe en MySQL con el `DATABASE_URL` del entorno. En producción, `asta_app`
 * basta: solo necesita INSERT.
 */
import '../apps/middleware/src/config/dotenv.js';
import { searchRead } from '../apps/middleware/src/odoo/client.js';
import { prisma } from '../apps/middleware/src/config/prisma.js';
import { importarPropuestas, type ProductoOdoo } from '../apps/middleware/src/services/recomendador/importarPropuestas.js';

const CATEGORIA_CONSUMIBLES = 2614;

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

await prisma.$disconnect();
process.exit(0);
