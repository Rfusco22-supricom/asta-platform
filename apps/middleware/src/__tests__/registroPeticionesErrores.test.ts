import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

/**
 * `registroPeticiones` cuando escribir la bitácora falla.
 *
 * La garantía es que la bitácora NUNCA tumba el proceso: sin ella se pierde
 * visibilidad, pero con una bitácora que lanza se pierde la API.
 *
 * Hay dos formas de fallar y la primera versión solo cubría una:
 *
 *   · el INSERT se rechaza (MySQL caído, una restricción): asíncrono
 *   · algo lanza de forma SÍNCRONA al preparar la escritura
 *
 * El código era `prisma.apiRequestLog.create(...).catch(...)`. Ese `.catch` no
 * llega a existir si `create` lanza antes de devolver una promesa, y la excepción
 * escapa del listener de `finish`. Una excepción no capturada en un listener de
 * eventos termina el proceso de Node.
 *
 * Prisma se sustituye aquí con `vi.mock`, en su propio fichero: espiar el
 * delegado real de Prisma y restaurarlo lo deja roto (es un Proxy).
 */

const create = vi.fn();
vi.mock('../config/prisma.js', () => ({ prisma: { apiRequestLog: { create } } }));

const { registroPeticiones } = await import('../middleware/registroPeticiones.js');

function peticionFalsa(): { req: Request; res: Response & EventEmitter } {
  const req = {
    originalUrl: '/api/v1/public/inventory?x=1',
    method: 'GET',
    ip: '10.0.0.1',
    get: () => 'test-agent',
    log: { warn: vi.fn(), error: vi.fn() },
  } as unknown as Request;

  const res = Object.assign(new EventEmitter(), {
    statusCode: 501,
    locals: {},
    json(this: unknown) {
      return this;
    },
  }) as unknown as Response & EventEmitter;

  return { req, res };
}

/** Pasa la petición por el middleware y dispara `finish`, como haría Express. */
function atender(req: Request, res: Response & EventEmitter): void {
  const next: NextFunction = () => {};
  registroPeticiones()(req, res, next);
  res.emit('finish');
}

describe('#29 · La bitácora nunca tumba el proceso', () => {
  it('si el INSERT se rechaza, no lanza y lo avisa por log', async () => {
    create.mockRejectedValueOnce(new Error('Can\'t reach database server'));
    const { req, res } = peticionFalsa();

    expect(() => atender(req, res)).not.toThrow();
    await vi.waitFor(() => expect(req.log?.warn).toHaveBeenCalled());
  });

  it('si algo lanza de forma SÍNCRONA, tampoco escapa del listener', async () => {
    // Es el caso que la primera versión no cubría: `create` lanza antes de
    // devolver una promesa. Con `.create(...).catch(...)` esta excepción salía
    // del listener de `finish` y terminaba el proceso.
    create.mockImplementationOnce(() => {
      throw new TypeError('prisma.apiRequestLog.create is not a function');
    });
    const { req, res } = peticionFalsa();

    expect(() => atender(req, res)).not.toThrow();
    await vi.waitFor(() => expect(req.log?.warn).toHaveBeenCalled());
  });

  it('en el caso normal escribe la fila sin la query string', async () => {
    create.mockResolvedValueOnce({});
    const { req, res } = peticionFalsa();

    atender(req, res);
    await vi.waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.lastCall?.[0]?.data).toMatchObject({
      path: '/api/v1/public/inventory',
      statusCode: 501,
      method: 'GET',
    });
  });
});
