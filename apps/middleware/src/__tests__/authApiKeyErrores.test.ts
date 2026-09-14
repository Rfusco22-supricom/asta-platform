import { describe, expect, it, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

/**
 * `authApiKey` ante un fallo de la base de datos.
 *
 * El middleware usa Express 4, que NO reenvía al manejador de errores lo que
 * lanza una función async. `authApiKey` hacía `await verifyApiKey()` sin
 * try/catch, así que un fallo de MySQL al verificar la key:
 *
 *   · dejaba la petición colgada, sin respuesta, y
 *   · emitía un `unhandledRejection`, que en Node 24 sin manejador global
 *     termina el proceso con código 1 — comprobado arrancando el servidor
 *     contra un MySQL inexistente.
 *
 * O sea: al montar la API pública, una sola petición con API key durante una
 * caída de la base habría tirado el middleware entero, panel de vendedores
 * incluido. No se había visto porque la API pública no estaba montada.
 *
 * `verifyApiKey` se sustituye por un fallo simulado: lo que se prueba aquí es el
 * reenvío del error, no la base de datos.
 */

vi.mock('../services/apiKey.service.js', () => ({
  verifyApiKey: vi.fn(),
}));

const { verifyApiKey } = await import('../services/apiKey.service.js');
const { authApiKey } = await import('../middleware/apiKeyAuth.js');

function fakeReq(): Request {
  const headers: Record<string, string> = { 'x-api-key': `asta_live_deadbeef_${'A'.repeat(43)}` };
  return { ip: '10.0.0.1', get: (n: string) => headers[n.toLowerCase()] } as unknown as Request;
}

describe('#36 · authApiKey con la base de datos caída', () => {
  it('reenvía el error a next() en vez de dejar la promesa rechazada', async () => {
    const fallo = new Error('Can\'t reach database server at `127.0.0.1:3306`');
    vi.mocked(verifyApiKey).mockRejectedValueOnce(fallo);

    const status = vi.fn();
    const res = { status, json: vi.fn() } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;

    // Si el middleware dejara escapar el rechazo, este await lanzaría.
    await expect(
      (authApiKey() as unknown as (r: Request, s: Response, n: NextFunction) => Promise<void>)(
        fakeReq(),
        res,
        next,
      ),
    ).resolves.toBeUndefined();

    expect(next).toHaveBeenCalledWith(fallo);
    // No responde por su cuenta: la respuesta la da el manejador de errores.
    expect(status).not.toHaveBeenCalled();
  });
});
