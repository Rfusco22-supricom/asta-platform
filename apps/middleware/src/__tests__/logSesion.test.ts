import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * El token de sesión no llega al log.
 *
 * El login y `/refresh` responden con `set-cookie: asta_rt=<token>`, el token de
 * refresco, que vale 30 días. `pino-http` registra las cabeceras de la RESPUESTA,
 * y la redacción solo tapaba las de la petición: cada login dejaba en el log un
 * token con el que entrar como esa persona durante un mes. Visto el 2026-10-01
 * en el log del servidor de desarrollo, con la misma configuración que
 * producción.
 *
 * Mismo montaje que `logDescargas.test.ts`, y por lo mismo: comprobar que la
 * configuración REAL de `server.ts` + `utils/logger.ts` lo tapa, no una copia.
 */

describe('Log de la sesión', () => {
  it('la línea del logout existe, sin la cookie de la petición ni el set-cookie de la respuesta', () => {
    const token = 'TOKENDESESIONDEPRUEBA0123456789';
    const script = fileURLToPath(new URL('./soportes/servidorConLogSesion.ts', import.meta.url));
    const tsx = createRequire(import.meta.url).resolve('tsx/cli');
    const r = spawnSync(process.execPath, [tsx, script, token], {
      cwd: fileURLToPath(new URL('../..', import.meta.url)),
      encoding: 'utf8',
      env: { ...process.env, LOG_LEVEL: 'info' },
      timeout: 60_000,
    });
    const salida = (r.stdout ?? '') + (r.stderr ?? '');

    expect(r.error, `no se pudo lanzar el proceso: ${r.error?.message ?? ''}`).toBeUndefined();
    expect(r.status, `el proceso terminó mal:\n${salida}`).toBe(0);

    // Que hay línea: un proceso que no loguea nada tampoco «contendría el token».
    const linea = salida.split('\n').find((l) => l.includes('/api/v1/auth/logout'));
    expect(linea, `no salió la línea del logout:\n${salida}`).toBeDefined();

    expect(linea).not.toContain(token);
    expect(linea).not.toContain('asta_rt');
    expect(linea!.toLowerCase()).not.toContain('set-cookie');
  });
});
