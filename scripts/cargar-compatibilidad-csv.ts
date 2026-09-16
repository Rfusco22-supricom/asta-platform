/**
 * Copia en la base de DESARROLLO un export CSV de `compatibilidad_productos`.
 *
 *   pnpm compatibilidades:cargar-csv --archivo ruta/compatibilidad_productos.csv
 *
 * La tabla se mantiene a mano en phpMyAdmin, en producción. Para probar el
 * importador y la pestaña «Impresoras» en local hace falta su contenido, y este
 * script lo carga desde el CSV que exporta phpMyAdmin (comillas dobles, NULL sin
 * comillas).
 *
 * Solo inserta las filas cuyo id no existe: se puede repetir. Se niega a correr
 * contra algo que no sea localhost, porque en producción la tabla es la fuente y
 * no se escribe desde aquí.
 */
import { readFileSync } from 'node:fs';
import '../apps/middleware/src/config/dotenv.js';
import { prisma } from '../apps/middleware/src/config/prisma.js';

const i = process.argv.indexOf('--archivo');
const archivo = i >= 0 ? process.argv[i + 1] : undefined;
if (!archivo) {
  console.error('Uso: pnpm compatibilidades:cargar-csv --archivo compatibilidad_productos.csv');
  process.exit(2);
}

const host = new URL(process.env.DATABASE_URL ?? 'mysql://x@nadie/x').hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  console.error(`DATABASE_URL apunta a «${host}», no a localhost. Este script es solo para desarrollo.`);
  process.exit(2);
}

/** Una línea del CSV de phpMyAdmin: "texto" entre comillas (con "" como comilla) o NULL. */
function campos(linea: string): Array<string | null> {
  return [...linea.matchAll(/"((?:[^"]|"")*)"|NULL/g)].map((m) => (m[1] === undefined ? null : m[1].replace(/""/g, '"')));
}

const [cabecera, ...lineas] = readFileSync(archivo, 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/);
const columnas = campos(cabecera);
const esperadas = ['id', 'code', 'marca', 'modelo', 'rendimiento_pag'];
if (JSON.stringify(columnas) !== JSON.stringify(esperadas)) {
  console.error(`Columnas inesperadas: ${JSON.stringify(columnas)}. Se esperaban ${JSON.stringify(esperadas)}.`);
  process.exit(2);
}

const filas = lineas.filter((l) => l.trim()).map((l) => {
  const [id, code, marca, modelo, rendimiento] = campos(l);
  return { id: Number(id), code: code ?? '', marca: marca ?? '', modelo: modelo ?? '', rendimientoPag: rendimiento === null ? null : Number(rendimiento) };
});

const r = await prisma.compatibilidadProducto.createMany({ data: filas, skipDuplicates: true });
console.log(`${filas.length} filas en el CSV · ${r.count} insertadas · ${filas.length - r.count} ya estaban`);
await prisma.$disconnect();
