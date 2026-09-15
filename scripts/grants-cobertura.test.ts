import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Que ninguna tabla nueva se quede sin decisión de permisos (#44).
 *
 * ── Por qué hace falta si ya existe `pnpm check:grants` ──────────────────────
 *
 * Porque `check:grants` consulta una base VIVA con `004_usuarios.sql` ya
 * aplicado, y eso hoy solo ocurre en producción: en desarrollo se conecta como
 * root y el comprobador contesta «ninguno de los usuarios tiene permisos por
 * tabla», que no es un aprobado ni un suspenso.
 *
 * Es decir: la red existía, pero solo se tensaba al final del recorrido. Añadir
 * seis tablas (#101) y olvidarse de concederlas no se habría notado hasta
 * desplegar, y el síntoma habría sido un informe roto —o peor, la tentación de
 * arreglarlo con un `GRANT ALL`, que es justo lo que #44 evita—.
 *
 * Esto compara los dos ficheros del repositorio, sin base de datos, así que
 * falla en el mismo commit que introduce la tabla.
 *
 * ── Lo que NO comprueba ──────────────────────────────────────────────────────
 *
 * Que los privilegios concedidos sean los correctos. Que `audit_logs` no lleve
 * UPDATE, o que nadie tenga DELETE, se decide leyendo el fichero: aquí solo se
 * exige que la tabla APAREZCA, es decir, que alguien haya tomado una decisión
 * sobre ella.
 */

const raiz = join(import.meta.dirname, '..');

/** Las tablas reales del esquema, según `@@map` en `schema.prisma`. */
function tablasDelEsquema(): string[] {
  const schema = readFileSync(join(raiz, 'prisma/schema.prisma'), 'utf8');
  return [...schema.matchAll(/@@map\("([a-z_]+)"\)/g)].map((m) => m[1]).sort();
}

/** Las tablas que `004_usuarios.sql` menciona para un usuario concreto. */
function tablasConcedidasA(usuario: string): Set<string> {
  const sql = readFileSync(join(raiz, 'db/mysql/004_usuarios.sql'), 'utf8');

  const tablas = new Set<string>();
  for (const linea of sql.split(/\r?\n/)) {
    // Solo GRANT de verdad: los comentarios nombran tablas para explicarlas.
    if (!linea.startsWith('GRANT')) continue;
    if (!linea.includes(`'${usuario}'@`)) continue;

    const m = linea.match(/\basta\.([a-z_]+)\b/);
    if (m) tablas.add(m[1]);
  }
  return tablas;
}

describe('cobertura de permisos', () => {
  it('el esquema tiene tablas que comprobar', () => {
    // Si el `@@map` cambia de forma, lo de abajo pasaría en vacío y no probaría
    // nada. Esto es lo que impide ese falso verde.
    expect(tablasDelEsquema().length).toBeGreaterThanOrEqual(23);
  });

  it('asta_app tiene una decisión para cada tabla', () => {
    const concedidas = tablasConcedidasA('asta_app');
    const sinDecision = tablasDelEsquema().filter((t) => !concedidas.has(t));

    expect(sinDecision).toEqual([]);
  });

  it('asta_lectura tiene una decisión para cada tabla, salvo las de credenciales', () => {
    /*
     * Las tres exclusiones son deliberadas y están razonadas en el fichero: su
     * contenido ES material de credencial. Van aquí escritas a mano para que
     * excluir una CUARTA tabla obligue a tocar este test y explicarlo, en vez
     * de ser un olvido que pasa desapercibido.
     */
    const excluidas = new Set(['user_credentials', 'auth_tokens', 'api_keys']);

    const concedidas = tablasConcedidasA('asta_lectura');
    const sinDecision = tablasDelEsquema().filter(
      (t) => !concedidas.has(t) && !excluidas.has(t),
    );

    expect(sinDecision).toEqual([]);
  });

  it('nadie recibe DELETE sobre una tabla suelta', () => {
    /*
     * `asta_migrador` sí lo tiene, pero sobre `asta.*` y en una línea aparte:
     * es el usuario de mantenimiento y para eso existe. Lo que esta prueba
     * impide es que DELETE se cuele en la lista tabla a tabla de `asta_app` o
     * de `asta_lectura`, que es donde nadie lo miraría.
     */
    const sql = readFileSync(join(raiz, 'db/mysql/004_usuarios.sql'), 'utf8');

    const conDelete = sql
      .split(/\r?\n/)
      .filter((l) => l.startsWith('GRANT'))
      .filter((l) => /\basta\.[a-z_]+\b/.test(l))
      .filter((l) => /\bDELETE\b/.test(l));

    expect(conDelete).toEqual([]);
  });
});
