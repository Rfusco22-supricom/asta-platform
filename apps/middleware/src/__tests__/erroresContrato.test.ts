import { describe, expect, it } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { apiErrorSchema, errorCodeSchema, HTTP_STATUS_BY_ERROR } from '@asta/shared-types';
import { errorHandler } from '../middleware/errorHandler.js';
import { InventarioNoDisponible } from '../services/inventory.service.js';
import { ForbiddenPartnerAccess, PartnerNotFound } from '../services/partners.service.js';
import { OdooError } from '../odoo/client.js';

/**
 * El cuerpo de error que sale de aquí tiene que validar contra el contrato.
 *
 * ── Por qué hacía falta ──────────────────────────────────────────────────────
 *
 * `/inventory` (#30) respondía 409 con `code: 'INVENTORY_UNAVAILABLE'`, un
 * código que NO estaba en `errorCodeSchema`. El 409 era correcto y el mensaje
 * también, pero `apiErrorSchema.parse()` lo rechazaba: para un cliente que
 * valide las respuestas con el contrato —que es para lo que se publica el
 * paquete— esa respuesta legítima era basura.
 *
 * No lo vio nadie porque el test comparaba la CADENA:
 *
 *     expect(r.body?.error?.code).toBe('INVENTORY_UNAVAILABLE');   // pasa igual
 *
 * Eso comprueba que el controlador escribe lo que el controlador escribe. No
 * comprueba nada del contrato.
 *
 * ── Qué se prueba aquí ───────────────────────────────────────────────────────
 *
 * El cuerpo contra `apiErrorSchema`, que es lo único que ata el código emitido a
 * la enumeración cerrada. Y sin Odoo ni base de datos: el fallo original vivía
 * en un test que necesita el ERP, así que en una máquina recién clonada no
 * corría.
 */

type ResEspia = Response & { codigo: number | null; cuerpo: unknown };

function fakeRes(): ResEspia {
  const res: Record<string, unknown> = { codigo: null, cuerpo: undefined, headersSent: false };
  res.status = (c: number) => {
    res.codigo = c;
    return res;
  };
  res.json = (b: unknown) => {
    res.cuerpo = b;
    return res;
  };
  return res as unknown as ResEspia;
}

const fakeReq = () => ({ query: {}, params: {}, path: '/x' }) as unknown as Request;
const noop = (() => {}) as NextFunction;

/** Pasa un error por el manejador y devuelve lo que se le respondería al cliente. */
function servir(error: unknown): { status: number | null; cuerpo: unknown } {
  const res = fakeRes();
  errorHandler(error, fakeReq(), res, noop);
  return { status: res.codigo, cuerpo: res.cuerpo };
}

describe('el cuerpo de error cumple el contrato', () => {
  /*
   * Todos los errores tipados de servicio, no solo el que falló.
   *
   * El fallo no fue de `/inventory`: fue de que nada comprobaba esto. Con un
   * caso suelto, el siguiente código inventado vuelve a colarse.
   */
  const casos: Array<[string, unknown, number]> = [
    ['InventarioNoDisponible', new InventarioNoDisponible(1001), 409],
    ['ForbiddenPartnerAccess', new ForbiddenPartnerAccess(428, 105982), 403],
    ['PartnerNotFound', new PartnerNotFound(999999), 404],
    ['OdooError', new OdooError('cayó', 'res.partner', 'search_read'), 503],
    ['error desconocido', new Error('lo que sea'), 500],
  ];

  for (const [nombre, error, status] of casos) {
    it(`${nombre} → ${status} y valida contra apiErrorSchema`, () => {
      const { status: recibido, cuerpo } = servir(error);
      expect(recibido).toBe(status);

      const r = apiErrorSchema.safeParse(cuerpo);
      // El mensaje del fallo lleva el cuerpo: si un día no valida, se ve por qué
      // sin tener que instrumentar el manejador.
      expect(r.success, `no valida: ${JSON.stringify(cuerpo)}`).toBe(true);
    });
  }

  it('INVENTORY_UNAVAILABLE está en la enumeración y es un 409', () => {
    // Explícito porque es el caso que se coló. `HTTP_STATUS_BY_ERROR` es
    // `Record<ErrorCode, number>`, así que añadir el código sin el status no
    // compila — esto fija el valor.
    expect(errorCodeSchema.safeParse('INVENTORY_UNAVAILABLE').success).toBe(true);
    expect(HTTP_STATUS_BY_ERROR.INVENTORY_UNAVAILABLE).toBe(409);
  });

  it('el status lo pone el mapa, no el error', () => {
    /*
     * `InventarioNoDisponible` declara `status = 409` y `errorHandler` lo
     * IGNORA: saca el status de `HTTP_STATUS_BY_ERROR[code]`.
     *
     * No es un detalle. Es lo que impide que dos endpoints respondan el mismo
     * código con status distintos, que es exactamente lo que pasaba cuando cada
     * controlador escribía su propio `res.status(...)`.
     */
    const mentiroso = Object.assign(new InventarioNoDisponible(7), { status: 418 });
    expect(servir(mentiroso).status).toBe(HTTP_STATUS_BY_ERROR.INVENTORY_UNAVAILABLE);
  });

  it('un mensaje interno no sale al cliente', () => {
    // Lo de siempre: el detalle va al log. Aquí se comprueba que el 500 genérico
    // no arrastra el mensaje del error original.
    const { cuerpo } = servir(new Error('SELECT * FROM app_users WHERE contraseña...'));
    expect(JSON.stringify(cuerpo)).not.toContain('app_users');
  });
});
