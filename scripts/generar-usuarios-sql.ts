import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

/**
 * `pnpm usuarios:sql` — adapta `004_usuarios.sql` a una instalación concreta (#44).
 *
 * ── Por qué existe ───────────────────────────────────────────────────────────
 *
 * `004_usuarios.sql` no se puede aplicar tal cual. Hay que tocarle tres cosas y
 * las tres se olvidan:
 *
 *   · Los diez marcadores `<CAMBIA_ESTA_*>` de las contraseñas.
 *   · Las cuarenta apariciones de `@'localhost'`, que en Docker no valen porque
 *     los contenedores no son localhost.
 *   · El nombre de la base. En Linux distingue mayúsculas, y la instalación real
 *     resultó llamarse `Asta`, no `asta`.
 *
 * Editar eso a mano en un fichero de 250 líneas sale mal. Ya salió mal una vez:
 * los marcadores iban entre comillas y aplicar el fichero sin editar creaba los
 * tres usuarios con contraseñas publicadas en el repositorio (lo encontró
 * @LinoGouveia). El arreglo fue quitarles las comillas para que sin sustituir no
 * sea SQL válido — bueno, pero sigue dejando el trabajo manual.
 *
 * Esto lo hace de una vez, con contraseñas al azar.
 *
 * ── Se SUSTITUYE sobre el fichero, no se reescribe ───────────────────────────
 *
 * El script lee `004_usuarios.sql` y solo reemplaza. No reimplementa ni un
 * GRANT. Si tuviera su propia copia de los privilegios, los dos se separarían al
 * primer cambio y el fichero versionado —que es el que la gente lee para
 * entender qué puede hacer cada usuario— dejaría de describir la realidad.
 */

function argumento(nombre: string, porDefecto: string): string {
  const i = process.argv.indexOf(`--${nombre}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : porDefecto;
}

/**
 * Contraseña aleatoria apta para un DSN.
 *
 * Se usa base64url y no base64: el `+`, el `/` y el `=` hay que codificarlos
 * dentro de una URL de conexión, y eso es exactamente el paso que se olvida y
 * produce un «Can't reach database server» que no menciona la contraseña por
 * ningún lado. Con base64url la clave se pega tal cual.
 */
function clave(): string {
  return randomBytes(33).toString('base64url');
}

const host = argumento('host', '%');
const base = argumento('base', 'Asta');
const origen = argumento('archivo', 'db/mysql/004_usuarios.sql');

const claves = {
  app: clave(),
  migrador: clave(),
  lectura: clave(),
};

let sql = readFileSync(origen, 'utf8');

// ── 1. El host ───────────────────────────────────────────────────────────────
sql = sql.replaceAll("@'localhost'", `@'${host}'`);

// ── 2. La base ───────────────────────────────────────────────────────────────
//
// Solo donde va seguida de un punto y un nombre de tabla, o de `.*`. Buscar
// "asta" a secas reemplazaría media prosa de los comentarios.
sql = sql.replace(/\basta\.(\*|[a-z_]+)/g, `\`${base}\`.$1`);

// ── 3. Las contraseñas ───────────────────────────────────────────────────────
sql = sql
  .replaceAll('<CAMBIA_ESTA_APP>', `'${claves.app}'`)
  .replaceAll('<CAMBIA_ESTA_MIGRADOR>', `'${claves.migrador}'`)
  .replaceAll('<CAMBIA_ESTA_LECTURA>', `'${claves.lectura}'`);

/*
 * Que no quede ni un marcador.
 *
 * Si el fichero cambia y aparece uno nuevo, esto lo para aquí en vez de
 * entregar un SQL que se aplicará a medias y dejará usuarios sin crear o —peor—
 * creados con una contraseña que es un texto del repositorio.
 */
// Solo en SQL de verdad. La cabecera del fichero trae `<CAMBIA_ESTA_XXX>` como
// ejemplo dentro de un comentario, y contarlo pararía el script por una línea
// de prosa.
const restantes = sql
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('--'))
  .join('\n')
  .match(/<CAMBIA_ESTA_[A-Z]+>/g);
if (restantes) {
  console.error(`\n  Quedan marcadores sin sustituir: ${[...new Set(restantes)].join(', ')}`);
  console.error('  Añádelos a este script antes de usarlo.\n');
  process.exit(1);
}

console.log(sql);

/*
 * Lo que hay que copiar va por el ERROR, no por la salida.
 *
 * Así `pnpm usuarios:sql > usuarios.sql` deja en el fichero solo el SQL, y las
 * contraseñas quedan en pantalla. Escribirlas dentro del fichero sería sembrar
 * una copia de las credenciales en el disco, justo en la carpeta del proyecto.
 */
console.error('');
console.error('  ─────────────────────────────────────────────────────────────');
console.error('  CONTRASEÑAS GENERADAS — cópialas ahora, no se vuelven a mostrar');
console.error('  ─────────────────────────────────────────────────────────────');
console.error('');
console.error(`  asta_app        ${claves.app}`);
console.error(`  asta_migrador   ${claves.migrador}`);
console.error(`  asta_lectura    ${claves.lectura}`);
console.error('');
console.error('  Para el middleware (solo esta, las otras dos NO van al despliegue):');
console.error('');
console.error(`    DATABASE_URL=mysql://asta_app:${claves.app}@<host-mysql>:3306/${base}`);
console.error('');
console.error('  Después de aplicarlo:  pnpm check:grants');
console.error('');
