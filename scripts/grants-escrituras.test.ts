import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * #44 · Lo que el código ESCRIBE cabe en lo que `asta_app` PUEDE escribir.
 *
 * La batería corre como root, así que una escritura sin permiso no falla en
 * ningún test: falla el día que producción entra como `asta_app`. Pasó: la
 * telemetría del recomendador (#43) actualizaba `recommendation_events`, que era
 * solo SELECT e INSERT, y el clic del kiosco habría dado 500 (visto el
 * 2026-10-01).
 *
 * Esto cruza, sin base de datos, cada `prisma.<modelo>.<operación>(` del código
 * de producción con los GRANT de `db/mysql/004_usuarios.sql`. Si una tabla solo
 * tiene UPDATE por columnas, comprueba también que lo que se escribe está en
 * esas columnas.
 *
 * Lo que NO ve: SQL crudo (hoy no hay) y escrituras a través de variables que
 * no se llamen `prisma` o `tx`. Es una red, no una demostración.
 */

const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const schema = leer('prisma/schema.prisma');
const grants = leer('db/mysql/004_usuarios.sql');

interface Modelo {
  tabla: string;
  /** campo de Prisma -> columna */
  columnas: Map<string, string>;
}

const modelos = new Map<string, Modelo>();
for (const m of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
  const tabla = m[2].match(/@@map\("(\w+)"\)/)?.[1];
  if (!tabla) continue;
  const columnas = new Map<string, string>();
  for (const l of m[2].split('\n')) {
    const campo = l.match(/^\s+(\w+)\s+\w/)?.[1];
    if (!campo || campo.startsWith('@@')) continue;
    columnas.set(campo, l.match(/@map\("(\w+)"\)/)?.[1] ?? campo);
  }
  modelos.set(m[1].charAt(0).toLowerCase() + m[1].slice(1), { tabla, columnas });
}

/** tabla -> privilegios de tabla, y columnas con UPDATE por columna. */
const permisos = new Map<string, { tabla: Set<string>; updateColumnas: Set<string> }>();
for (const g of grants.matchAll(/^GRANT (.+?) ON asta\.(\w+)\s+TO 'asta_app'/gm)) {
  const p = permisos.get(g[2]) ?? { tabla: new Set<string>(), updateColumnas: new Set<string>() };
  for (const parte of g[1].split(/,(?![^(]*\))/).map((s) => s.trim())) {
    const conColumnas = parte.match(/^(\w+)\s*\(([^)]*)\)$/);
    if (conColumnas?.[1] === 'UPDATE') for (const c of conColumnas[2].split(',')) p.updateColumnas.add(c.trim());
    else p.tabla.add(parte);
  }
  permisos.set(g[2], p);
}

const NECESITA: Record<string, string[]> = {
  create: ['INSERT'],
  createMany: ['INSERT'],
  createManyAndReturn: ['INSERT'],
  update: ['UPDATE'],
  updateMany: ['UPDATE'],
  upsert: ['INSERT', 'UPDATE'],
  delete: ['DELETE'],
  deleteMany: ['DELETE'],
};

const raiz = new URL('../apps/middleware/src/', import.meta.url);
const ficheros: string[] = [];
const recorrer = (dir: string) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      if (f !== '__tests__') recorrer(p);
    } else if (p.endsWith('.ts')) ficheros.push(p);
  }
};
recorrer(fileURLToPath(raiz));

/** Las claves del objeto `data:` que sigue a la llamada. Aproximado, a propósito. */
function camposEscritos(src: string, desde: number): string[] {
  const resto = src.slice(desde, desde + 600);
  const data = resto.match(/data:\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/)?.[1] ?? '';
  return [...data.matchAll(/(\w+)\s*:/g)].map((m) => m[1]);
}

describe('#44 · Escrituras frente a permisos de asta_app', () => {
  const problemas: string[] = [];

  for (const f of ficheros) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\b(?:prisma|tx)\.(\w+)\.(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)\(/g)) {
      const modelo = modelos.get(m[1]);
      if (!modelo) continue;
      const p = permisos.get(modelo.tabla) ?? { tabla: new Set<string>(), updateColumnas: new Set<string>() };
      const donde = `${f.split(sep).join('/').replace(/^.*apps\/middleware\/src\//, '')}:${src.slice(0, m.index).split('\n').length}`;

      for (const necesario of NECESITA[m[2]]) {
        if (p.tabla.has(necesario)) continue;
        if (necesario === 'UPDATE' && p.updateColumnas.size > 0) {
          const fuera = camposEscritos(src, m.index!)
            .map((c) => modelo.columnas.get(c))
            .filter((c): c is string => Boolean(c) && !p.updateColumnas.has(c!));
          if (fuera.length) problemas.push(`${donde} ${m[1]}.${m[2]}: escribe ${fuera.join(', ')}, fuera del UPDATE por columnas`);
          continue;
        }
        problemas.push(`${donde} ${m[1]}.${m[2]}: ${modelo.tabla} necesita ${necesario}`);
      }
    }
  }

  it('ninguna escritura necesita un permiso que asta_app no tiene', () => {
    expect(problemas).toEqual([]);
  });

  it('el UPDATE por columnas de la telemetría es exactamente el de #43', () => {
    // Ampliarlo es poder reescribir la bitácora: que se note en el diff.
    expect([...(permisos.get('recommendation_events')?.updateColumnas ?? [])].sort()).toEqual([
      'clicked_product_id',
      'matched_printer_id',
      'was_out_of_stock',
    ]);
  });

  it('el cruce encuentra escrituras: si no, no comprueba nada', () => {
    // Sin esto, un cambio en la ruta o en la expresión dejaría el test en verde
    // sin haber mirado un solo fichero.
    expect(ficheros.length).toBeGreaterThan(50);
    expect(modelos.size).toBeGreaterThan(20);
    expect(permisos.size).toBeGreaterThan(20);
  });
});
