import { build } from 'esbuild';

/**
 * Empaquetado del middleware para producción.
 *
 * ── Por qué se empaqueta en vez de compilar con `tsc` ────────────────────────
 *
 * `@asta/shared-types` publica TypeScript SIN compilar —`main: ./src/index.ts`—
 * y es una decisión deliberada: Next lo transpila con `transpilePackages` y
 * Metro lo resuelve directo, así que no hay un paso de build que recordar antes
 * de cada cambio.
 *
 * Eso funciona para Next y para `tsx` en desarrollo, pero rompe la compilación
 * clásica: un `dist/server.js` de Node no puede importar un `.ts` en tiempo de
 * ejecución. Empaquetar resuelve el problema sin tocar esa decisión — el código
 * compartido entra dentro del bundle y deja de existir como dependencia.
 *
 * De paso, la imagen de Docker queda con un único fichero en vez de un
 * `node_modules` entero, que es la diferencia entre 60 MB y 400.
 *
 * ── Lo que NO se puede empaquetar ────────────────────────────────────────────
 *
 * Los módulos con binario nativo. `@prisma/client` carga un motor compilado por
 * plataforma, y `@node-rs/argon2` es una biblioteca Rust. Meterlos en el bundle
 * los rompe: esbuild empaqueta el JavaScript y deja atrás el `.node` que ese
 * JavaScript busca en una ruta relativa.
 *
 * Por eso van como `external` y se instalan en la imagen, donde npm resuelve el
 * binario de Linux — que no es el de esta máquina Windows.
 */
await build({
  /*
   * VARIOS puntos de entrada, no uno.
   *
   * El servidor es el obvio. El CLI de contraseñas es el que casi se queda
   * fuera: `002_seed.sql` crea el SuperAdmin SIN contraseña a propósito —un
   * hash de ejemplo en un fichero versionado acaba en producción—, así que sin
   * este ejecutable en la imagen no hay forma de poner la primera clave y NADIE
   * puede entrar al panel recién desplegado.
   *
   * Se descubrió preparando el primer despliegue real, con el contenedor ya
   * construido.
   */
  entryPoints: [
    'src/server.ts',
    'src/cli/set-password.ts',
    'src/cli/sync-partners.ts',
    'src/cli/sync-vendedores.ts',
  ],
  outdir: 'dist',
  // Para que `src/cli/set-password.ts` salga en `dist/cli/`, y no en `dist/`.
  outbase: 'src',
  bundle: true,
  platform: 'node',
  // La versión de Node que declara `engines`. Poner una mayor generaría sintaxis
  // que el contenedor podría no entender.
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  // Sin minificar: pesa poco y una traza legible en producción vale más que
  // ahorrar unos kilobytes en un servidor que no descarga nadie.
  minify: false,
  external: ['@prisma/client', '.prisma/client', '@node-rs/argon2'],
  /*
   * Node no define `require` en un módulo ESM, y algunas dependencias
   * (`xmlrpc`, `pino`) lo usan por dentro al empaquetarlas. Sin esto, el bundle
   * arranca y falla en la primera llamada con "require is not defined".
   */
  banner: {
    js: [
      "import { createRequire as __astaCreateRequire } from 'node:module';",
      'const require = __astaCreateRequire(import.meta.url);',
    ].join('\n'),
  },
  logLevel: 'info',
});
