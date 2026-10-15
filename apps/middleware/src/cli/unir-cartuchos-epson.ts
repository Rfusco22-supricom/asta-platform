/**
 * Junta las botellas Epson guardadas sin su T con las que la llevan (#56).
 *
 * En desarrollo:
 *
 *   pnpm cartuchos:unir-epson             SIMULACRO: dice qué haría y no escribe
 *   pnpm cartuchos:unir-epson --aplicar   escribe
 *
 * Dentro del contenedor del middleware:
 *
 *   node dist/cli/unir-cartuchos-epson.js [--aplicar]
 *
 * Va ANTES de `importar-propuestas`: así las tintas ASTA ("A-544BK") se
 * proponen ya contra el T544, el de las impresoras. Se puede repetir: la
 * segunda vez no encuentra nada. Ver `unirCartuchosEpson.ts`.
 */
import { prisma } from '../config/prisma.js';
import { unirCartuchosEpson } from '../services/recomendador/unirCartuchosEpson.js';

async function main(): Promise<void> {
  const aplicar = process.argv.includes('--aplicar');
  console.log(`\n  botellas Epson sin T → con T${aplicar ? ' — APLICANDO' : ' — SIMULACRO (nada se escribe)'}\n`);

  const r = await unirCartuchosEpson({ aplicar });
  const v = (hecho: string, futuro: string) => (aplicar ? hecho : futuro);

  for (const u of r.unidos) {
    console.log(`  ${u.de.padEnd(6)} → ${u.a.padEnd(7)} ${u.productos} productos y ${u.impresoras} impresoras ${v('pasados', 'pasarían')}; el ${u.de} ${v('queda', 'quedaría')} como ${u.retirado}`);
    if (u.repetidos) console.log(`         ${u.repetidos} enlaces ya estaban en el ${u.a}: ${v('quedan', 'quedarían')} en ${u.retirado}; recházalos en el panel`);
  }
  for (const n of r.renombrados) console.log(`  ${n.de.padEnd(6)} → ${n.a.padEnd(7)} ${v('renombrado', 'se renombraría')} (no había ${n.a})`);
  if (!r.unidos.length && !r.renombrados.length) console.log('  Nada que unir: todas las botellas Epson ya llevan su T.');

  if (!aplicar) console.log('\n  Nada se ha escrito. Para aplicarlo: --aplicar\n');
  else console.log('\n  Hecho. Lanza después importar-propuestas para proponer las tintas ASTA contra el cartucho bueno.\n');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
