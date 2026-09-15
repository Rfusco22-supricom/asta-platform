import { spawnSync } from 'node:child_process';
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
    const r = spawnSync('pnpm', ['exec', 'tsx', script, token], {
      cwd: fileURLToPath(new URL('../..', import.meta.url)),
      encoding: 'utf8',
      env: { ...process.env, LOG_LEVEL: 'info' },
      timeout: 60_000,
    });
    const salida = r.stdout + r.stderr;

    // Sin esta comprobación, un proceso que no llega a loguear nada también
    // "no contendría el token".
    expect(salida).toContain('/api/v1/descargas/facturas/[oculto]');
    expect(salida).not.toContain('TOKENDEPRUEBA');
    expect(salida).not.toContain('FIRMADEPRUEBA');
  });
});
