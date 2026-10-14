/**
 * Guarda en el repositorio las compatibilidades revisadas de esta base (#56).
 *
 * En desarrollo, contra la base donde se hizo la revisión:
 *
 *   pnpm validaciones:exportar
 *
 * Escribe `src/services/recomendador/validacionesRevisadas.json`, que se
 * commitea y viaja DENTRO de la imagen: `trasladar-validaciones` lo aplica en
 * producción sin tener que subir ficheros al contenedor. Solo lee la base.
 *
 * Ver `trasladoValidaciones.ts`.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { prisma } from '../config/prisma.js';
import { exportarValidaciones } from '../services/recomendador/trasladoValidaciones.js';

const DESTINO = fileURLToPath(new URL('../services/recomendador/validacionesRevisadas.json', import.meta.url));

async function main(): Promise<void> {
  const t = await exportarValidaciones();
  // Una decisión por línea: así el diff de una revisión nueva se puede leer.
  const lineas = (filas: unknown[]) => filas.map((f) => `    ${JSON.stringify(f)}`).join(',\n');
  const json = [
    '{',
    `  "exportado": ${JSON.stringify(t.exportado)},`,
    `  "cartuchos": [\n${lineas(t.cartuchos)}\n  ],`,
    `  "impresoras": [\n${lineas(t.impresoras)}\n  ],`,
    `  "productoCartucho": [\n${lineas(t.productoCartucho)}\n  ],`,
    `  "cartuchoImpresora": [\n${lineas(t.cartuchoImpresora)}\n  ]`,
    '}',
    '',
  ].join('\n');
  writeFileSync(DESTINO, json);

  const cuenta = (filas: Array<{ estado: string }>, e: string) => filas.filter((f) => f.estado === e).length;
  console.log(`\n  ${DESTINO}\n`);
  console.log(`  ${t.cartuchos.length} cartuchos · ${t.impresoras.length} impresoras`);
  console.log(`  producto → cartucho:  ${cuenta(t.productoCartucho, 'VALIDADA')} validadas, ${cuenta(t.productoCartucho, 'RECHAZADA')} rechazadas`);
  console.log(`  cartucho → impresora: ${cuenta(t.cartuchoImpresora, 'VALIDADA')} validadas, ${cuenta(t.cartuchoImpresora, 'RECHAZADA')} rechazadas\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
