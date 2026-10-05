import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * `prisma/linea-base.prisma` es la referencia del paso 1 de
 * `docs/09-BASELINE-PRISMA.md`: describe producción tal como se montó a mano.
 * Si se desalinea, el paso 1 da deriva donde no la hay —o, peor, deja de verla—,
 * y la guía dice que con deriva se para. Esto lo vigila sin base de datos.
 */

// Sin CR: en Windows Git deja unos ficheros con CRLF y otros con LF.
const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const lineaBase = leer('prisma/linea-base.prisma');
const schema = leer('prisma/schema.prisma');

/** Las migraciones de la línea base, las que el paso 2 marca como aplicadas. */
const MIGRACIONES_BASE = ['0_init', '20260914120000_api_logs_pk_compuesta', '20260914130000_api_usage_monthly'];

const modelo = (fuente: string, nombre: string) => fuente.match(new RegExp(`^model ${nombre} \\{[\\s\\S]*?^\\}`, 'm'))?.[0];

describe('docs/09 · linea-base.prisma', () => {
  it('declara exactamente las tablas de las tres migraciones, más las creadas en phpMyAdmin', () => {
    const creadas = MIGRACIONES_BASE.flatMap((m) =>
      [...leer(`prisma/migrations/${m}/migration.sql`).matchAll(/CREATE TABLE `(\w+)`/g)].map((x) => x[1]),
    );
    const declaradas = [...lineaBase.matchAll(/@@map\("(\w+)"\)/g)].map((x) => x[1]);

    expect(declaradas.sort()).toEqual([...creadas, 'compatibilidad_productos', 'ventas_smartbit'].sort());
  });

  it.each(['CompatibilidadProducto', 'VentaSmartbit'])('el modelo %s es el mismo que en schema.prisma', (nombre) => {
    // La guía pide ajustarlo en los dos si producción tiene otros tipos: si solo
    // se toca uno, el paso 1 da una deriva que no existe.
    const enBase = modelo(lineaBase, nombre);
    expect(enBase).toBeDefined();
    expect(enBase).toBe(modelo(schema, nombre));
  });
});
