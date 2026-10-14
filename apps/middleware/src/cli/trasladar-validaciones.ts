/**
 * Aplica en esta base las compatibilidades revisadas en desarrollo (#56).
 *
 * Dentro del contenedor del middleware:
 *
 *   node dist/cli/trasladar-validaciones.js --revisor <email SUPERADMIN>             SIMULACRO
 *   node dist/cli/trasladar-validaciones.js --revisor <email SUPERADMIN> --aplicar   escribe
 *
 * El fichero va DENTRO del ejecutable (`validacionesRevisadas.json`, que saca
 * `exportar-validaciones`): no hay que subir nada al contenedor. El revisor es
 * quien responde de la revisión en esta base, y tiene que ser SUPERADMIN, como
 * para validar desde el panel.
 *
 * Se puede repetir: lo que ya tiene la misma decisión no se toca, y una decisión
 * DISTINTA tomada aquí nunca se pisa, se lista. Ver `trasladoValidaciones.ts`.
 */
import { prisma } from '../config/prisma.js';
import { aplicarTraslado, type Traslado } from '../services/recomendador/trasladoValidaciones.js';
import { resolverRevisor } from '../services/recomendador/validarPropuestas.js';
import revisadas from '../services/recomendador/validacionesRevisadas.json';

const n = (x: number) => String(x).padStart(5);
const arg = (nombre: string) => {
  const i = process.argv.indexOf(nombre);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main(): Promise<void> {
  const email = arg('--revisor');
  const aplicar = process.argv.includes('--aplicar');
  if (!email) {
    console.error('Uso: trasladar-validaciones --revisor <email SUPERADMIN> [--aplicar]');
    process.exitCode = 2;
    return;
  }
  const revisor = await resolverRevisor(email);
  const t = revisadas as unknown as Traslado;

  console.log(`\n  compatibilidades revisadas (exportadas ${t.exportado.slice(0, 10)}) → esta base${aplicar ? ' — APLICANDO' : ' — SIMULACRO (nada se escribe)'}`);
  console.log(`  revisor: ${revisor.email}\n`);

  const r = await aplicarTraslado(t, { aplicar, revisorId: revisor.id });
  const v = (hecho: string, futuro: string) => (aplicar ? hecho : futuro);

  console.log(`  ${n(t.productoCartucho.length + t.cartuchoImpresora.length)}  decisiones en el fichero`);
  console.log(`  ${n(r.creadas)}  enlaces ${v('creados', 'se crearían')} ya decididos`);
  console.log(`  ${n(r.decididas)}  propuestas que ${v('pasan', 'pasarían')} a la decisión revisada`);
  console.log(`  ${n(r.iguales)}  ya tenían la misma decisión (no se tocan)`);
  console.log(`  ${n(r.cartuchosCreados)}  cartuchos ${v('creados', 'se crearían')}`);
  console.log(`  ${n(r.impresorasCreadas)}  impresoras ${v('creadas', 'se crearían')}, ${r.impresorasUnidas.length} unidas a una que ya estaba`);
  console.log(`  ${n(r.aliasCreados)}  alias ${v('creados', 'se crearían')}`);
  if (r.marcasCreadas.length) console.log(`  marcas ${v('creadas', 'que se crearían')}: ${r.marcasCreadas.join(', ')}`);

  if (r.impresorasUnidas.length) {
    console.log('\n  Impresoras que ya estaban con otro nombre — revisa que sean la misma:');
    for (const u of r.impresorasUnidas) console.log(`    ${u.traslado}  →  ${u.aqui}`);
  }
  if (r.conflictos.length) {
    console.log('\n  Decididas aquí de otra forma — NO se tocan, decide en el panel:');
    for (const c of r.conflictos) console.log(`    ${c.que}  ${c.enlace}: aquí ${c.aqui}, en el fichero ${c.traslado}`);
  }
  if (r.incompletos) console.log(`\n  ${r.incompletos} decisiones sin su cartucho o su impresora en el fichero: vuelve a exportarlo.`);

  if (!aplicar) console.log('\n  Nada se ha escrito. Para aplicarlo: --aplicar\n');
  else console.log('\n  Hecho. El kiosco lo enseña en un minuto, cuando caduca su caché de compatibles.\n');
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
