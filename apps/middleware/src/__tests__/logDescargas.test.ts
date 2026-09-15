import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * #32 · El enlace firmado no llega al log.
 *
 * `ocultarTokenDeUrl` tiene sus tests, pero sin este nada comprobaba que
 * `server.ts` lo USA: quitar el serializer de `pino-http` pasaba toda la suite
 * (verificado por mutación). Durante 5 minutos la URL de descarga es la
 * credencial, y un log se copia a un ticket sin pensarlo.
 */

describe('#32 · Log de las descargas', () => {
  it('la línea de la petición existe, y lleva la ruta sin el token', () => {
    const token = 'TOKENDEPRUEBA0123456789.FIRMADEPRUEBA9876543210';
    const script = fileURLToPath(new URL('./soportes/servidorConLog.ts', import.meta.url));

    /*
     * Se lanza `node <tsx/cli>`, NO `pnpm exec tsx`.
     *
     * Con `pnpm` el test no podía pasar en Windows: `pnpm` ahí es un `.cmd`, y
     * `spawnSync` sin `shell` no resuelve shims. Daba ENOENT, `stdout` quedaba
     * vacío y la primera aserción fallaba — siempre, en todas las máquinas del
     * equipo, que son Windows.
     *
     *     spawnSync('pnpm', ['--version'])                -> ENOENT
     *     spawnSync('pnpm', ['--version'], {shell: true}) -> "11.20.0"
     *
     * `shell: true` lo arreglaría, pero Node avisa (DEP0190) de pasar `args`
     * con `shell` porque se concatenan sin escapar. Resolver el binario y
     * ejecutarlo con el mismo Node que corre el test se salta el intérprete de
     * comandos entero, y de paso no depende de qué gestor de paquetes se use.
     */
    const tsx = createRequire(import.meta.url).resolve('tsx/cli');
    const r = spawnSync(process.execPath, [tsx, script, token], {
      cwd: fileURLToPath(new URL('../..', import.meta.url)),
      encoding: 'utf8',
      env: { ...process.env, LOG_LEVEL: 'info' },
      timeout: 60_000,
    });
    const salida = (r.stdout ?? '') + (r.stderr ?? '');

    /*
     * Que el proceso ARRANCÓ, antes de mirar lo que escribió.
     *
     * Sin esto, un fallo al lanzarlo se presentaba como «expected [] to include
     * /api/v1/descargas/facturas/[oculto]», que apunta al serializer del log
     * cuando el problema estaba tres líneas más arriba. Se perdió un rato
     * buscando en el sitio equivocado.
     */
    expect(r.error, `no se pudo lanzar el proceso: ${r.error?.message ?? ''}`).toBeUndefined();
    expect(r.status, `el proceso terminó mal:\n${salida}`).toBe(0);

    // Sin esta comprobación, un proceso que no llega a loguear nada también
    // "no contendría el token".
    expect(salida).toContain('/api/v1/descargas/facturas/[oculto]');
    expect(salida).not.toContain('TOKENDEPRUEBA');
    expect(salida).not.toContain('FIRMADEPRUEBA');
  });
});
