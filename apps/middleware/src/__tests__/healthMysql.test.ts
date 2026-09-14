import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * La sonda de MySQL de `/health` (issue #77).
 *
 * ── Por qué existe este fichero ──────────────────────────────────────────────
 *
 * En el primer despliegue real, `/health` dijo
 *
 *     "mysql": { "ok": true, "ms": 9 }
 *
 * mientras cada consulta de la aplicación moría con «User was denied access on
 * the database». Conexión viva, base inservible, semáforo en verde.
 *
 * La sonda hacía `SELECT 1`, que no toca ninguna tabla y por tanto no puede
 * detectar que al usuario le falten permisos. Estos tests fijan la consulta que
 * lo sustituye y, sobre todo, fijan que DETECTA el caso que se escapó.
 *
 * Se prueba la consulta directamente y no el endpoint: lo que falló fue la
 * elección de la consulta, y es ahí donde tiene que haber una red.
 */

const SONDA = 'SELECT 1 FROM app_users LIMIT 1';
const SONDA_VIEJA = 'SELECT 1';

/** Usuario que puede conectar a la base pero NO leer sus tablas. */
const USUARIO = 'asta_test_sonda';
const CLAVE = 'prueba-sonda-2026';

let raiz: PrismaClient;
let limitado: PrismaClient | null = null;
let base = '';
let disponible = false;

beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) return;

  base = new URL(url).pathname.replace(/^\//, '');
  raiz = new PrismaClient({ log: [] });

  try {
    await raiz.$executeRawUnsafe(`DROP USER IF EXISTS '${USUARIO}'@'localhost'`);
    await raiz.$executeRawUnsafe(`CREATE USER '${USUARIO}'@'localhost' IDENTIFIED BY '${CLAVE}'`);
    /*
     * INSERT y no SELECT, a propósito. Es el permiso mínimo que deja CONECTAR a
     * la base sin poder leer ninguna tabla — exactamente la situación del
     * despliegue. Con un usuario sin ningún permiso las dos sondas fallarían y
     * el test no distinguiría nada.
     */
    await raiz.$executeRawUnsafe(`GRANT INSERT ON \`${base}\`.* TO '${USUARIO}'@'localhost'`);
    await raiz.$executeRawUnsafe('FLUSH PRIVILEGES');

    const u = new URL(url);
    u.username = USUARIO;
    u.password = CLAVE;
    limitado = new PrismaClient({ datasources: { db: { url: u.toString() } }, log: [] });
    disponible = true;
  } catch {
    // Sin permisos para crear usuarios no se puede montar el escenario. Se
    // marca como no disponible en vez de fallar: el test diría que el código
    // está mal cuando lo que falta es un permiso del entorno.
    disponible = false;
  }
}, 60_000);

afterAll(async () => {
  await limitado?.$disconnect();
  if (raiz) {
    await raiz
      .$executeRawUnsafe(`DROP USER IF EXISTS '${USUARIO}'@'localhost'`)
      .catch(() => undefined);
    await raiz.$disconnect();
  }
});

describe('#77 · La sonda detecta permisos que faltan', () => {
  it('la sonda VIEJA pasaba en verde: es el fallo que se busca', async () => {
    if (!disponible) return;

    // No es una comprobación del código actual, es la demostración del agujero.
    // Si algún día esto empieza a fallar, `SELECT 1` habrá dejado de ser
    // inofensivo y el razonamiento de abajo habría que revisarlo.
    await expect(limitado!.$queryRawUnsafe(SONDA_VIEJA)).resolves.toBeDefined();
  });

  it('la sonda NUEVA falla, que es lo correcto', async () => {
    if (!disponible) return;

    await expect(limitado!.$queryRawUnsafe(SONDA)).rejects.toThrow();
  });
});

describe('#77 · Y no inventa fallos donde no los hay', () => {
  it('con permisos, pasa', async () => {
    if (!disponible) return;
    await expect(raiz.$queryRawUnsafe(SONDA)).resolves.toBeDefined();
  });

  it('una tabla VACÍA no es un fallo', async () => {
    if (!disponible) return;

    /*
     * `LIMIT 1` sobre cero filas devuelve cero filas SIN error, y eso es lo que
     * se quiere: la sonda mide acceso, no contenido. Una base recién migrada y
     * todavía sin datos está sana.
     */
    await raiz.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS zz_sonda_vacia (id INT)');
    try {
      await expect(raiz.$queryRawUnsafe('SELECT 1 FROM zz_sonda_vacia LIMIT 1')).resolves.toBeDefined();
    } finally {
      await raiz.$executeRawUnsafe('DROP TABLE IF EXISTS zz_sonda_vacia');
    }
  });

  it('una tabla que no existe SÍ es un fallo', async () => {
    if (!disponible) return;

    // El esquema sin migrar deja la aplicación inservible igual que la falta de
    // permisos, así que el health tiene que decirlo.
    await expect(raiz.$queryRawUnsafe('SELECT 1 FROM zz_no_migrada LIMIT 1')).rejects.toThrow();
  });
});
