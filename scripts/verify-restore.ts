// Solo para poner el .env en process.env. No valida nada ni lanza (issue #9).
import '../apps/middleware/src/config/dotenv.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ejecutar = promisify(execFile);

/**
 * `pnpm backup:verificar` — el simulacro de restauración (issue #48).
 *
 * ── Por qué existe ───────────────────────────────────────────────────────────
 *
 * Un respaldo no probado no es un respaldo, es una suposición. Lo peligroso no
 * es que falle el volcado —eso se nota— sino que salga un fichero que parece
 * correcto y al restaurarlo falte algo: los procedimientos de mantenimiento, una
 * colación, el particionado.
 *
 * Esto hace el viaje completo contra la base de verdad: vuelca, restaura en una
 * base desechable, compara las dos y la borra. Cronometra el RTO de paso, que es
 * el número que hay que saber ANTES de necesitarlo.
 *
 * ── Lo que compara, y por qué justo eso ──────────────────────────────────────
 *
 * No basta con contar filas. Cada comprobación de abajo corresponde a algo que
 * un volcado mal hecho pierde EN SILENCIO:
 *
 *   · rutinas       `mysqldump` no las incluye sin `--routines`. Comprobado:
 *                   sin esa bandera los dos procedimientos de #47 desaparecen.
 *   · colaciones    `app_users.email` es `utf8mb4_bin`. Con una `_ci`, dos
 *                   personas distintas no pueden tener cuenta (#12).
 *   · particiones   se pierden si el volcado no conserva la definición.
 *   · primarias     `api_request_logs` la tiene compuesta por el particionado.
 *   · filas         lo obvio, y aun así hay que mirarlo.
 *
 * No se ejecuta en la batería de tests: tarda, necesita `mysqldump` en el PATH y
 * crea bases. Es un simulacro, y un simulacro se hace a propósito.
 */

interface Conexion {
  host: string;
  port: string;
  user: string;
  password: string;
  base: string;
}

function leerUrl(url: string): Conexion {
  const u = new URL(url);
  return {
    host: u.hostname || 'localhost',
    port: u.port || '3306',
    user: decodeURIComponent(u.username || 'root'),
    password: decodeURIComponent(u.password || ''),
    base: u.pathname.replace(/^\//, ''),
  };
}

/**
 * Argumentos de conexión para mysql/mysqldump.
 *
 * La contraseña va por `MYSQL_PWD` en el entorno del proceso hijo, no en los
 * argumentos: lo segundo la deja visible en `ps` para cualquiera que esté en la
 * máquina. En el servidor se usa un fichero de credenciales (ver respaldar.sh);
 * aquí, que es un script de desarrollo que lee del `.env`, el entorno basta.
 */
function args(c: Conexion): string[] {
  return [`--host=${c.host}`, `--port=${c.port}`, `--user=${c.user}`];
}

function entorno(c: Conexion): NodeJS.ProcessEnv {
  return c.password ? { ...process.env, MYSQL_PWD: c.password } : { ...process.env };
}

const MYSQL = process.env.MYSQL_BIN ?? 'mysql';
const MYSQLDUMP = process.env.MYSQLDUMP_BIN ?? 'mysqldump';

async function sql(c: Conexion, base: string, consulta: string): Promise<string> {
  const { stdout } = await ejecutar(MYSQL, [...args(c), '-N', '-B', base, '-e', consulta], {
    env: entorno(c),
    maxBuffer: 32 * 1024 * 1024,
  });
  // El cliente de MySQL en Windows termina las lineas con CRLF. Sin quitar el
  // retorno de carro, cada nombre que se parte por salto de linea arrastra uno
  // al final, y la consulta siguiente falla con "Incorrect table name".
  return stdout.replace(/\r/g, '').trim();
}

/** Retrato estructural de una base: lo que tiene que sobrevivir al viaje. */
interface Retrato {
  tablas: Map<string, number>;
  rutinas: string[];
  colaciones: Map<string, string>;
  particiones: string[];
  primarias: Map<string, string>;
}

async function retratar(c: Conexion, base: string): Promise<Retrato> {
  const filasDe = async (tabla: string): Promise<number> =>
    Number(await sql(c, base, `SELECT COUNT(*) FROM \`${tabla}\``));

  const nombres = (await sql(c, base, `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA='${base}' AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME`))
    .split('\n')
    .filter(Boolean);

  const tablas = new Map<string, number>();
  // COUNT(*) de verdad y no TABLE_ROWS de information_schema: en InnoDB ese
  // valor es una estimación del optimizador y puede desviarse mucho. Comparar
  // dos estimaciones no demuestra nada.
  for (const t of nombres) tablas.set(t, await filasDe(t));

  const rutinas = (await sql(c, base, `SELECT CONCAT(ROUTINE_TYPE,':',ROUTINE_NAME)
      FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA='${base}' ORDER BY ROUTINE_NAME`))
    .split('\n')
    .filter(Boolean);

  const colaciones = new Map<string, string>();
  const filasCol = (await sql(c, base, `SELECT CONCAT(TABLE_NAME,'.',COLUMN_NAME), COLLATION_NAME
      FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='${base}' AND COLLATION_NAME IS NOT NULL
      ORDER BY TABLE_NAME, COLUMN_NAME`))
    .split('\n')
    .filter(Boolean);
  for (const f of filasCol) {
    const [k, v] = f.split('\t');
    colaciones.set(k, v);
  }

  const particiones = (await sql(c, base, `SELECT CONCAT(TABLE_NAME,':',PARTITION_NAME)
      FROM information_schema.PARTITIONS WHERE TABLE_SCHEMA='${base}' AND PARTITION_NAME IS NOT NULL
      ORDER BY TABLE_NAME, PARTITION_ORDINAL_POSITION`))
    .split('\n')
    .filter(Boolean);

  const primarias = new Map<string, string>();
  const filasPk = (await sql(c, base, `SELECT TABLE_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX)
      FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='${base}' AND INDEX_NAME='PRIMARY'
      GROUP BY TABLE_NAME ORDER BY TABLE_NAME`))
    .split('\n')
    .filter(Boolean);
  for (const f of filasPk) {
    const [k, v] = f.split('\t');
    primarias.set(k, v);
  }

  return { tablas, rutinas, colaciones, particiones, primarias };
}

function compararMapas(
  nombre: string,
  original: Map<string, string | number>,
  restaurado: Map<string, string | number>,
): string[] {
  const problemas: string[] = [];

  for (const [k, v] of original) {
    if (!restaurado.has(k)) problemas.push(`${nombre}: falta ${k}`);
    else if (restaurado.get(k) !== v) {
      problemas.push(`${nombre}: ${k} era ${v} y quedó ${restaurado.get(k)}`);
    }
  }
  for (const k of restaurado.keys()) {
    if (!original.has(k)) problemas.push(`${nombre}: sobra ${k} en lo restaurado`);
  }

  return problemas;
}

function compararListas(nombre: string, original: string[], restaurado: string[]): string[] {
  const problemas: string[] = [];
  const b = new Set(restaurado);
  const a = new Set(original);

  for (const x of original) if (!b.has(x)) problemas.push(`${nombre}: falta ${x}`);
  for (const x of restaurado) if (!a.has(x)) problemas.push(`${nombre}: sobra ${x}`);

  return problemas;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta DATABASE_URL.');

  const c = leerUrl(url);
  const origen = c.base;
  const destino = `${origen}_simulacro`;

  console.log(`\n  Simulacro de restauración`);
  console.log(`  origen  ${origen}`);
  console.log(`  destino ${destino} (se borra al terminar)\n`);

  const carpeta = mkdtempSync(join(tmpdir(), 'asta-simulacro-'));
  const archivo = join(carpeta, 'respaldo.sql');
  let problemas: string[] = [];

  try {
    // ── 1. Volcar ────────────────────────────────────────────────────────────
    const t0 = Date.now();
    await ejecutar(
      MYSQLDUMP,
      [
        ...args(c),
        '--single-transaction',
        // Sin estas dos, los procedimientos de #47 no salen y nadie se entera.
        '--routines',
        '--events',
        '--triggers',
        '--hex-blob',
        '--default-character-set=utf8mb4',
        '--result-file=' + archivo,
        origen,
      ],
      { env: entorno(c), maxBuffer: 256 * 1024 * 1024 },
    );
    const msVolcado = Date.now() - t0;
    const tamano = statSync(archivo).size;

    console.log(`  volcado     ${(tamano / 1024 / 1024).toFixed(1)} MB en ${(msVolcado / 1000).toFixed(1)} s`);

    // ── 2. Restaurar ─────────────────────────────────────────────────────────
    const t1 = Date.now();
    await ejecutar(
      MYSQL,
      [...args(c), '-e', `DROP DATABASE IF EXISTS \`${destino}\`;
         CREATE DATABASE \`${destino}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`],
      { env: entorno(c) },
    );

    // `mysql < fichero` necesita una shell para la redirección; se usa
    // `--execute=source` para no depender de ella ni de cómo cite Windows.
    await ejecutar(
      MYSQL,
      [
        ...args(c),
        '--default-character-set=utf8mb4',
        destino,
        '-e',
        `source ${archivo.replace(/\\/g, '/')}`,
      ],
      { env: entorno(c), maxBuffer: 256 * 1024 * 1024 },
    );
    const msRestauracion = Date.now() - t1;

    console.log(`  restaurado  en ${(msRestauracion / 1000).toFixed(1)} s`);

    // ── 3. Comparar ──────────────────────────────────────────────────────────
    const [a, b] = await Promise.all([retratar(c, origen), retratar(c, destino)]);

    problemas = [
      ...compararMapas('tablas', a.tablas, b.tablas),
      ...compararListas('rutinas', a.rutinas, b.rutinas),
      ...compararMapas('colaciones', a.colaciones, b.colaciones),
      ...compararListas('particiones', a.particiones, b.particiones),
      ...compararMapas('primarias', a.primarias, b.primarias),
    ];

    const filas = [...a.tablas.values()].reduce((s, n) => s + n, 0);

    console.log('');
    console.log(`  tablas      ${a.tablas.size}`);
    console.log(`  filas       ${filas.toLocaleString('es-VE')}`);
    console.log(`  rutinas     ${a.rutinas.length}`);
    console.log(`  particiones ${a.particiones.length}`);
    console.log('');

    if (problemas.length === 0) {
      console.log('  Lo restaurado es idéntico al original.\n');
      // El RTO que importa no es este: en el día malo hay que descargar el
      // fichero, montar el servidor y reaplicar los usuarios. Esto es la parte
      // de base de datos, que es la que se puede medir con honestidad.
      console.log(
        `  RTO de base de datos: ${((msVolcado + msRestauracion) / 1000).toFixed(1)} s ` +
          `(volcado ${(msVolcado / 1000).toFixed(1)} + restauración ${(msRestauracion / 1000).toFixed(1)})`,
      );
      console.log('  No incluye traslado del fichero, alta del servidor ni 004_usuarios.sql.\n');
    } else {
      console.log(`  ${problemas.length} DIFERENCIAS entre el original y lo restaurado:\n`);
      for (const p of problemas.slice(0, 40)) console.log(`    · ${p}`);
      if (problemas.length > 40) console.log(`    … y ${problemas.length - 40} más`);
      console.log('');
    }
  } finally {
    // La base desechable se borra pase lo que pase. Dejarla ahí es sembrar la
    // duda de cuál es la buena.
    await ejecutar(MYSQL, [...args(c), '-e', `DROP DATABASE IF EXISTS \`${destino}\``], {
      env: entorno(c),
    }).catch(() => undefined);
    rmSync(carpeta, { recursive: true, force: true });
  }

  if (problemas.length > 0) process.exit(1);
}

// Sin Prisma a propósito: esto habla por la CLI de MySQL, que es la herramienta
// que existe en el servidor el día que hay que restaurar. Abrir además una
// conexión de Prisma no aportaría nada.
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
