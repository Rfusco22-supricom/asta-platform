/**
 * Une las impresoras que entraron dos veces con dos nombres (#173).
 *
 * En desarrollo:
 *
 *   pnpm impresoras:unir             SIMULACRO: dice qué haría y no escribe
 *   pnpm impresoras:unir --aplicar   escribe
 *
 * Dentro del contenedor del middleware:
 *
 *   node dist/cli/unir-impresoras-duplicadas.js [--aplicar]
 *
 * Lista cada grupo con la que se queda y las que se desactivan. Lo dudoso y los
 * conflictos se enseñan y no se tocan. Ver `unirImpresorasDuplicadas.ts`.
 */
import { prisma } from '../config/prisma.js';
import { unirImpresorasDuplicadas } from '../services/recomendador/unirImpresorasDuplicadas.js';

const n = (x: number) => String(x).padStart(5);

async function main(): Promise<void> {
  const aplicar = process.argv.includes('--aplicar');
  console.log(`\n  impresoras duplicadas → una sola${aplicar ? ' — APLICANDO' : ' — SIMULACRO (nada se escribe)'}\n`);

  const r = await unirImpresorasDuplicadas({ aplicar });
  const v = (hecho: string, futuro: string) => (aplicar ? hecho : futuro);

  r.grupos.forEach((g, i) => {
    const detalle = [g.tonersMovidos && `${g.tonersMovidos} tóner movido${g.tonersMovidos > 1 ? 's' : ''}`, g.tonersRepetidos && `${g.tonersRepetidos} repetido${g.tonersRepetidos > 1 ? 's' : ''}`]
      .filter(Boolean)
      .join(', ');
    console.log(`  ${String(i + 1).padStart(3)}. ${g.marca} «${g.queda}» ← ${g.sobran.map((s) => `«${s}»`).join(', ')}${detalle ? `  (${detalle})` : ''}`);
  });

  console.log('');
  console.log(`  ${n(r.impresoras)}  impresoras activas`);
  console.log(`  ${n(r.grupos.length)}  grupos ${v('unidos', 'se unirían')}`);
  console.log(`  ${n(r.grupos.reduce((s, g) => s + g.sobran.length, 0))}  impresoras ${v('desactivadas', 'se desactivarían')} (su nombre queda como alias)`);
  console.log(`  ${n(r.grupos.reduce((s, g) => s + g.tonersMovidos, 0))}  tóners ${v('movidos', 'se moverían')} a la que se queda`);

  if (r.dudosos.length) {
    console.log('\n  Dudosos — enlazados pero no todos la misma entre ellos; no se tocan:');
    for (const d of r.dudosos) console.log(`    ${d.map((x) => `«${x}»`).join(', ')}`);
  }
  if (r.conflictos.length) {
    console.log('\n  Conflictos — el mismo tóner validado en una y rechazado en otra; no se tocan:');
    for (const c of r.conflictos) console.log(`    ${c.marca} ${c.impresoras.map((x) => `«${x}»`).join(', ')} · ${c.cartucho}`);
  }
  if (!aplicar) console.log('\n  Nada se ha escrito. Para aplicarlo: --aplicar\n');
  else console.log('\n  El kiosco deja de enseñar las desactivadas cuando caduque su caché del catálogo (5 min).\n');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
