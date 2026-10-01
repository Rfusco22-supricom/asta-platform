/**
 * Carga las impresoras que vende Supricom, de la categoría IMPRESORA de Odoo (#40).
 *
 * En desarrollo:
 *
 *   pnpm impresoras-catalogo:importar             SIMULACRO: dice qué haría y no escribe
 *   pnpm impresoras-catalogo:importar --aplicar   escribe
 *
 * Dentro del contenedor del middleware:
 *
 *   node dist/cli/importar-impresoras-catalogo.js [--aplicar]
 *
 * No depende de los otros importadores ni ellos de este: se puede pasar en
 * cualquier orden. Solo crea o marca impresoras, ninguna compatibilidad. El
 * kiosco las enseña al momento —en cinco minutos, lo que tarda en caducar su
 * caché del catálogo— y manda al mostrador mientras no tengan tóner validado.
 */
import { prisma } from '../config/prisma.js';
import { searchRead } from '../odoo/client.js';
import { importarImpresorasDeCatalogo, type ProductoImpresora } from '../services/recomendador/importarImpresorasDeCatalogo.js';

/** La categoría IMPRESORA de esta instancia. Como `CATEGORIA_CONSUMIBLES` en `importar-impresoras`. */
const CATEGORIA_IMPRESORAS = 2610;

const n = (x: number) => String(x).padStart(5);

async function main(): Promise<void> {
  const aplicar = process.argv.includes('--aplicar');
  console.log(`\n  catálogo de Odoo → impresoras que vendemos${aplicar ? ' — APLICANDO' : ' — SIMULACRO (nada se escribe)'}\n`);

  const productos = await searchRead<ProductoImpresora>(
    'product.template',
    [['categ_id', 'child_of', CATEGORIA_IMPRESORAS]],
    ['name', 'default_code'],
    // Las archivadas también: se dejaron de vender, pero el cliente que la
    // compró la sigue teniendo y sigue necesitando tóner.
    { context: { active_test: false } },
  );

  const r = await importarImpresorasDeCatalogo(productos, { aplicar });
  const v = (hecho: string, futuro: string) => (aplicar ? hecho : futuro);

  console.log(`  ${n(r.productos)}  productos leídos`);
  console.log(`  ${n(r.descartados.no_es_impresora)}  no son impresoras (escáneres, bandejas, placas, etiquetadoras…)`);
  console.log(`  ${n(r.descartados.sin_marca)}  sin una marca que sepamos leer (SAT: térmicas, no llevan tóner)`);
  console.log(`  ${n(r.descartados.sin_modelo)}  sin un modelo reconocible en el nombre`);
  console.log(`  ${n(r.impresoras)}  impresoras distintas`);
  console.log(`  ${n(r.marcasCreadas)}  marcas ${v('creadas', 'se crearían')}`);
  console.log(`  ${n(r.creadas)}  impresoras nuevas ${v('creadas', 'se crearían')}`);
  console.log(`  ${n(r.marcadas)}  ya estaban: ${v('marcadas', 'se marcarían')} como del catálogo`);
  console.log(`  ${n(r.yaMarcadas)}  ya estaban marcadas (no se tocan)`);
  if (r.desactivadas) console.log(`  ${n(r.desactivadas)}  de las que ya estaban, desactivadas: siguen sin salir en el kiosco`);

  if (!aplicar) console.log('\n  Nada se ha escrito. Para aplicarlo: --aplicar\n');
  else console.log('\n  El kiosco las enseña cuando caduque su caché del catálogo (5 min).\n');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
