import { PrismaClient } from '@prisma/client';

/*
 * Cliente propio y CALLADO, en vez del compartido de la aplicación.
 *
 * Ese registra cada consulta cuando NODE_ENV=development, que para el servidor
 * está bien y aquí entierra el informe bajo el SQL que lo produce. Un script que
 * se lee de un vistazo no puede escupir veinte líneas de ruido antes del
 * resultado.
 */
const prisma = new PrismaClient({ log: ['warn', 'error'] });

/**
 * `pnpm check:grants` — revisa los permisos de MySQL (issue #44).
 *
 * ── Qué problema resuelve ────────────────────────────────────────────────────
 *
 * `004_usuarios.sql` concede permisos TABLA A TABLA, no con `asta.*`. Eso es lo
 * que permite que la aplicación no pueda borrar filas ni reescribir la auditoría,
 * y que el usuario de informes no lea los hashes de contraseña.
 *
 * El precio es que una tabla nueva no queda cubierta hasta que alguien la añada
 * al fichero. Si nadie lo comprueba, la primera señal será un error en
 * producción — o, peor, nada: la tabla nueva simplemente no será legible para
 * los informes y alguien "lo arreglará" con un `GRANT ALL`, que tira por tierra
 * todo el issue.
 *
 * Este script convierte eso en un fallo visible y temprano: compara las tablas
 * que existen de verdad contra las que tienen permiso concedido, y avisa de las
 * que nadie ha decidido todavía.
 *
 * ── Y de paso, lo que no debe pasar nunca ────────────────────────────────────
 *
 * Comprueba que ningún usuario de ASTA tenga privilegios globales ni ALL
 * PRIVILEGES. Un `GRANT ALL` puesto a las tres de la mañana para desatascar algo
 * es exactamente como mueren estos ficheros.
 */

/** Usuarios que este fichero gobierna. Otros (root, el de backups) no se tocan. */
const USUARIOS = ['asta_app', 'asta_migrador', 'asta_lectura'];

/**
 * Contraseñas que dejaban las versiones ANTERIORES de 004_usuarios.sql.
 *
 * Aquellas llevaban los marcadores entre comillas —'CAMBIA_ESTA_APP'—, que es
 * una cadena válida: aplicar el fichero sin editarlo creaba los usuarios con una
 * clave publicada en este repositorio. La versión actual los deja sin comillas
 * y el fichero no llega a ejecutarse, pero eso no repara una base donde ya se
 * aplicó la versión vieja. Para eso está esta comprobación.
 */
const CLAVES_DE_EJEMPLO: Record<string, string> = {
  asta_app: 'CAMBIA_ESTA_APP',
  asta_migrador: 'CAMBIA_ESTA_MIGRADOR',
  asta_lectura: 'CAMBIA_ESTA_LECTURA',
};

type ResultadoLogin = 'entra' | 'denegado' | 'no-comprobable';

/**
 * Intenta abrir una conexión con otro usuario y otra clave sobre el mismo
 * servidor y la misma base que DATABASE_URL.
 *
 * Solo el éxito es concluyente. MySQL responde el mismo "Access denied" (1045)
 * a una clave equivocada y a un usuario que no existe o no casa por host, así
 * que un rechazo NO demuestra que la clave sea buena: solo que desde esta
 * conexión no se entra con la de ejemplo. Y cualquier otro error se reporta
 * como no comprobable, en vez de darlo por bueno.
 */
async function probarLogin(urlBase: string, usuario: string, clave: string): Promise<ResultadoLogin> {
  const u = new URL(urlBase);
  u.username = usuario;
  u.password = encodeURIComponent(clave);

  const cliente = new PrismaClient({ datasources: { db: { url: u.toString() } }, log: [] });
  try {
    await cliente.$queryRawUnsafe('SELECT 1');
    return 'entra';
  } catch (e) {
    return /Authentication failed/i.test(String((e as Error).message)) ? 'denegado' : 'no-comprobable';
  } finally {
    await cliente.$disconnect();
  }
}

/**
 * Tablas que a propósito NO se conceden a nadie de la aplicación.
 *
 * `_prisma_migrations` la gestiona la CLI de Prisma corriendo como migrador; la
 * aplicación no la lee en marcha y desde ahí solo serviría para falsificar el
 * historial.
 */
const SIN_CONCEDER_A_PROPOSITO = new Set(['_prisma_migrations']);

function nombreBase(url: string): string {
  const m = /\/([^/?]+)(\?|$)/.exec(url);
  if (!m) throw new Error('No se pudo leer el nombre de la base de DATABASE_URL.');
  return m[1];
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta DATABASE_URL.');
  const base = nombreBase(url);

  const tablas = await prisma.$queryRawUnsafe<Array<{ t: string }>>(
    `SELECT TABLE_NAME AS t FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
    base,
  );

  /*
   * Se lee de information_schema y no de SHOW GRANTS porque esto puede correr
   * como un usuario que no es root: `TABLE_PRIVILEGES` solo devuelve lo que el
   * que pregunta tiene derecho a ver. Si sale vacío, se dice, en vez de cantar
   * victoria por no haber encontrado problemas.
   */
  const concesiones = await prisma.$queryRawUnsafe<
    Array<{ usuario: string; tabla: string; privilegio: string }>
  >(
    `SELECT SUBSTRING_INDEX(GRANTEE, '''', 2) AS usuario,
            TABLE_NAME  AS tabla,
            PRIVILEGE_TYPE AS privilegio
       FROM information_schema.TABLE_PRIVILEGES
      WHERE TABLE_SCHEMA = ?`,
    base,
  );

  const globales = await prisma.$queryRawUnsafe<
    Array<{ usuario: string; privilegio: string }>
  >(
    `SELECT SUBSTRING_INDEX(GRANTEE, '''', 2) AS usuario, PRIVILEGE_TYPE AS privilegio
       FROM information_schema.USER_PRIVILEGES
      WHERE PRIVILEGE_TYPE <> 'USAGE'`,
  );

  const porUsuario = new Map<string, Map<string, Set<string>>>();
  for (const c of concesiones) {
    const u = c.usuario.replace(/^'/, '');
    if (!porUsuario.has(u)) porUsuario.set(u, new Map());
    const tablas = porUsuario.get(u)!;
    if (!tablas.has(c.tabla)) tablas.set(c.tabla, new Set());
    tablas.get(c.tabla)!.add(c.privilegio);
  }

  const presentes = USUARIOS.filter((u) => porUsuario.has(u));

  /*
   * Qué usuarios de ASTA EXISTEN, que no es lo mismo que `presentes`.
   *
   * `presentes` sale de TABLE_PRIVILEGES, y ahí solo aparece quien tiene permisos
   * tabla a tabla. `asta_migrador` los tiene sobre `asta.*`, a nivel de base, que
   * se registran en SCHEMA_PRIVILEGES: con `presentes` nunca se le comprobaba
   * nada. USER_PRIVILEGES en cambio lista a todo usuario, porque todos tienen al
   * menos la fila USAGE.
   */
  const filasUsuarios = await prisma.$queryRawUnsafe<Array<{ usuario: string }>>(
    `SELECT DISTINCT SUBSTRING_INDEX(GRANTEE, '''', 2) AS usuario
       FROM information_schema.USER_PRIVILEGES`,
  );
  const existentes = new Set(filasUsuarios.map((f) => f.usuario.replace(/^'/, '')));
  const asta = USUARIOS.filter((u) => existentes.has(u));

  console.log(`\n  Base: ${base}  ·  ${tablas.length} tablas\n`);

  // ── Contraseñas de ejemplo ────────────────────────────────────────────────
  // Va ANTES de la salida temprana de abajo, a proposito: esa salida mira
  // `presentes`, y un usuario con permisos solo a nivel de base —el migrador,
  // el unico con DDL— la haria saltar con codigo 0 sin comprobar su clave.
  let clavesDeEjemplo = 0;
  for (const usuario of asta) {
    const clave = CLAVES_DE_EJEMPLO[usuario];
    if (!clave) continue;

    const r = await probarLogin(url, usuario, clave);
    if (r === 'entra') {
      clavesDeEjemplo += 1;
      console.log(`  MAL  ${usuario}: entra con la contraseña de ejemplo '${clave}'`);
      console.log('       → está publicada en el repositorio. Cámbiala YA con:');
      console.log(`         ALTER USER '${usuario}'@'<host>' IDENTIFIED BY '<clave aleatoria>';`);
    } else if (r === 'denegado') {
      console.log(`  ok   ${usuario}: no entra con la contraseña de ejemplo desde esta conexión`);
    } else {
      clavesDeEjemplo += 1;
      console.log(`  ??   ${usuario}: no se pudo comprobar la contraseña de ejemplo`);
      console.log('       → error distinto de "autenticación fallida"; no se da por bueno.');
    }
  }
  if (asta.length > 0) console.log('');

  if (presentes.length === 0) {
    // No es un aprobado. Es que todavía no se ha aplicado 004_usuarios.sql, o
    // que quien pregunta no tiene permiso para ver las concesiones.
    console.log('  Ninguno de los usuarios de ASTA tiene permisos por tabla en esta base.');
    console.log('  O no se ha aplicado db/mysql/004_usuarios.sql, o esta conexión no');
    console.log('  puede ver las concesiones (information_schema filtra por permisos).\n');
    console.log('  En desarrollo es normal: se conecta como root. En producción NO.\n');
    await prisma.$disconnect();
    // Antes salia siempre con 0. Una clave de ejemplo encontrada arriba no puede
    // quedar tapada por no haber permisos por tabla.
    process.exit(clavesDeEjemplo > 0 ? 1 : 0);
  }

  let problemas = clavesDeEjemplo;

  // ── 1. Tablas sin decisión ────────────────────────────────────────────────
  const dePlantilla = porUsuario.get('asta_app') ?? new Map();
  const huerfanas = tablas
    .map((r) => r.t)
    .filter((t) => !SIN_CONCEDER_A_PROPOSITO.has(t) && !dePlantilla.has(t));

  if (huerfanas.length > 0) {
    problemas += huerfanas.length;
    console.log('  Tablas que existen y asta_app no tiene concedidas:\n');
    for (const t of huerfanas) console.log(`    · ${t}`);
    console.log('\n  Si son suyas, añádelas a 004_usuarios.sql con los privilegios');
    console.log('  mínimos que necesiten. Si NO son suyas, añádelas a la lista');
    console.log('  SIN_CONCEDER_A_PROPOSITO de este script, para que conste la decisión.\n');
  }

  // ── 2. Privilegios globales ───────────────────────────────────────────────
  const globalesDeAsta = globales.filter((g) =>
    USUARIOS.includes(g.usuario.replace(/^'/, '')),
  );
  if (globalesDeAsta.length > 0) {
    problemas += globalesDeAsta.length;
    console.log('  PRIVILEGIOS GLOBALES en usuarios de ASTA. No debería haber ninguno:\n');
    for (const g of globalesDeAsta) {
      console.log(`    · ${g.usuario.replace(/^'/, '')} → ${g.privilegio} ON *.*`);
    }
    console.log('');
  }

  // ── 3. Invariantes que definen este issue ─────────────────────────────────
  const invariantes: Array<{ usuario: string; regla: string; mal: string[] }> = [];

  const app = porUsuario.get('asta_app');
  if (app) {
    const conDelete = [...app.entries()]
      .filter(([, p]) => p.has('DELETE'))
      .map(([t]) => t);
    invariantes.push({
      usuario: 'asta_app',
      regla: 'no puede borrar filas: la aplicación nunca borra, usa borrado suave',
      mal: conDelete,
    });

    const bitacoras = ['audit_logs', 'api_request_logs', 'recommendation_events'];
    const reescribibles = bitacoras.filter(
      (t) => app.get(t)?.has('UPDATE') || app.get(t)?.has('DELETE'),
    );
    invariantes.push({
      usuario: 'asta_app',
      regla: 'no puede reescribir las bitácoras: una auditoría modificable no es una auditoría',
      mal: reescribibles,
    });

    const ddl = ['CREATE', 'ALTER', 'DROP', 'INDEX'];
    const conDdl = [...app.entries()]
      .filter(([, p]) => ddl.some((d) => p.has(d)))
      .map(([t]) => t);
    invariantes.push({ usuario: 'asta_app', regla: 'no puede cambiar el esquema', mal: conDdl });
  }

  const lectura = porUsuario.get('asta_lectura');
  if (lectura) {
    const secretos = ['user_credentials', 'auth_tokens', 'api_keys'];
    invariantes.push({
      usuario: 'asta_lectura',
      regla: 'no lee tablas de credenciales',
      mal: secretos.filter((t) => lectura.has(t)),
    });

    const escribe = [...lectura.entries()]
      .filter(([, p]) => [...p].some((x) => x !== 'SELECT'))
      .map(([t]) => t);
    invariantes.push({ usuario: 'asta_lectura', regla: 'solo lee', mal: escribe });
  }

  for (const inv of invariantes) {
    if (inv.mal.length === 0) {
      console.log(`  ok   ${inv.usuario}: ${inv.regla}`);
    } else {
      problemas += inv.mal.length;
      console.log(`  MAL  ${inv.usuario}: ${inv.regla}`);
      console.log(`       → ${inv.mal.join(', ')}`);
    }
  }


  console.log('');
  await prisma.$disconnect();

  if (problemas > 0) {
    console.log(`  ${problemas} ${problemas === 1 ? 'problema' : 'problemas'}.\n`);
    process.exit(1);
  }
  console.log('  Permisos correctos.\n');
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
