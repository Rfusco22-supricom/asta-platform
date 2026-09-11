import { describe, expect, it, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import type { Identity } from '@asta/shared-types';
import { requireScope, scopeToOwnPartner } from '../middleware/apiKeyAuth.js';

/**
 * Issue #27 — `requireScope` y `scopeToOwnPartner`.
 *
 * Estos dos middleware son funciones puras sobre `req`/`res`: no tocan Prisma
 * ni Odoo, asi que se prueban sin base de datos. Eso importa mas de lo que
 * parece — `isolation.test.ts` necesita MySQL y hoy no corre en una maquina
 * recien clonada, de modo que si el aislamiento por cliente solo estuviera
 * cubierto ahi, no estaria cubierto en la practica.
 *
 * `authApiKey` no se prueba aqui: llama a `verifyApiKey`, que si pega a la base
 * de datos. Va aparte cuando haya una DATABASE_URL alcanzable.
 *
 * Los casos marcados con `it.fails` documentan fallos REALES descritos en el
 * issue #27. Afirman el comportamiento correcto, no el actual: mientras el bug
 * viva, el cuerpo falla y `it.fails` lo da por bueno. En cuanto alguien arregle
 * el codigo, `it.fails` empezara a fallar y habra que convertirlo en un `it`
 * normal. Es la forma de fijar un bug conocido sin dejar la suite en rojo.
 */

const UUID_USER = '00000000-0000-4000-8000-000000000001';
const UUID_KEY = '00000000-0000-4000-8000-0000000000aa';

/** Identidad de un cliente BRONCE cualquiera. Su partner en Odoo es el 1001. */
function identidad(over: Partial<Identity> = {}): Identity {
  return {
    appUserId: UUID_USER,
    role: 'BRONCE',
    odooPartnerId: 1001,
    odooUserId: null,
    odooPricelistId: 15866,
    scopes: ['INVENTORY_READ'],
    apiKeyId: UUID_KEY,
    ...over,
  };
}

type ResEspia = Response & { codigo: number | null; cuerpo: unknown };

function fakeRes(): ResEspia {
  // Se construye como objeto suelto y se castea una sola vez al final: tipar
  // `status` y `json` uno a uno contra las firmas de Express obliga a devolver
  // un Response completo, que es justo lo que este doble no es.
  const res: Record<string, unknown> = { codigo: null, cuerpo: undefined };
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

function fakeReq(over: Partial<Request> = {}): Request {
  return { query: {}, ...over } as unknown as Request;
}

/**
 * `req.log` lo tipa pino-http como su `Logger` completo, no como la interfaz
 * reducida de `types/express.d.ts`. Para un test solo hacen falta `warn` y
 * `error`, asi que el cast se queda aqui en vez de repetirse en cada caso.
 */
function fakeLog(warn: ReturnType<typeof vi.fn>): Request['log'] {
  return { warn, error: vi.fn() } as unknown as Request['log'];
}

/** Ejecuta un middleware y reporta si llamo a next(). */
function correr(mw: ReturnType<typeof requireScope>, req: Request, res: Response) {
  let paso = false;
  const next: NextFunction = () => {
    paso = true;
  };
  mw(req, res, next);
  return paso;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('#27 · requireScope', () => {
  it('deja pasar cuando la key tiene el scope exigido', () => {
    const req = fakeReq({ identity: identidad({ scopes: ['INVENTORY_READ'] }) });
    const res = fakeRes();

    expect(correr(requireScope('INVENTORY_READ'), req, res)).toBe(true);
    expect(res.codigo).toBeNull();
  });

  it('responde 403 cuando le falta el scope', () => {
    const req = fakeReq({ identity: identidad({ scopes: ['INVENTORY_READ'] }) });
    const res = fakeRes();

    expect(correr(requireScope('ORDERS_WRITE'), req, res)).toBe(false);
    expect(res.codigo).toBe(403);
    expect(res.cuerpo).toMatchObject({ error: { code: 'INSUFFICIENT_SCOPE' } });
  });

  it('exige TODOS los scopes pedidos, no basta con uno', () => {
    const req = fakeReq({ identity: identidad({ scopes: ['ORDERS_READ'] }) });
    const res = fakeRes();

    expect(correr(requireScope('ORDERS_READ', 'ORDERS_WRITE'), req, res)).toBe(false);
    expect(res.codigo).toBe(403);
  });

  it('el 403 enumera exactamente los scopes que faltan', () => {
    const req = fakeReq({ identity: identidad({ scopes: ['INVENTORY_READ'] }) });
    const res = fakeRes();

    correr(requireScope('INVENTORY_READ', 'PRICING_READ', 'ORDERS_WRITE'), req, res);

    const cuerpo = res.cuerpo as { error: { message: string } };
    expect(cuerpo.error.message).toContain('PRICING_READ');
    expect(cuerpo.error.message).toContain('ORDERS_WRITE');
    // El que SI tiene no debe aparecer en la lista de faltantes.
    expect(cuerpo.error.message).not.toContain('INVENTORY_READ');
  });

  it('sin identidad responde 403 y no revienta', () => {
    // Si alguien monta requireScope() sin authApiKey() delante, el resultado
    // debe ser una denegacion limpia, no un 500 con traza.
    const req = fakeReq();
    const res = fakeRes();

    expect(correr(requireScope('INVENTORY_READ'), req, res)).toBe(false);
    expect(res.codigo).toBe(403);
  });

  it('una key sin ningun scope no pasa por ninguna puerta', () => {
    const req = fakeReq({ identity: identidad({ scopes: [] }) });
    const res = fakeRes();

    expect(correr(requireScope('INVENTORY_READ'), req, res)).toBe(false);
    expect(res.codigo).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('#27 · scopeToOwnPartner', () => {
  it('deriva scopedPartnerId del token', () => {
    const req = fakeReq({ identity: identidad() });
    correr(scopeToOwnPartner(), req, fakeRes());

    expect(req.scopedPartnerId).toBe(1001);
  });

  it('sobreescribe un partner_id ajeno que venga en el body', () => {
    const req = fakeReq({ identity: identidad(), body: { partner_id: 2002 } });
    correr(scopeToOwnPartner(), req, fakeRes());

    expect(req.body.partner_id).toBe(1001);
  });

  it('no registra nada cuando el partner_id pedido es el suyo', () => {
    const warn = vi.fn();
    const req = fakeReq({
      identity: identidad(),
      body: { partner_id: 1001 },
      log: fakeLog(warn),
    });
    correr(scopeToOwnPartner(), req, fakeRes());

    expect(warn).not.toHaveBeenCalled();
  });

  it('registra el intento cruzado cuando llega por body', () => {
    const warn = vi.fn();
    const req = fakeReq({
      identity: identidad(),
      body: { partner_id: 2002 },
      log: fakeLog(warn),
    });
    correr(scopeToOwnPartner(), req, fakeRes());

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[1]).toBe('intento de acceso cruzado entre clientes');
  });

  it('registra el intento cruzado cuando llega por query', () => {
    const warn = vi.fn();
    const req = fakeReq({
      identity: identidad(),
      query: { partner_id: '2002' },
      log: fakeLog(warn),
    });
    correr(scopeToOwnPartner(), req, fakeRes());

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('acepta el partner_id propio expresado como cadena', () => {
    // `?partner_id=1001` llega como string. No debe contarse como intento cruzado.
    const warn = vi.fn();
    const req = fakeReq({
      identity: identidad(),
      query: { partner_id: '1001' },
      log: fakeLog(warn),
    });
    correr(scopeToOwnPartner(), req, fakeRes());

    expect(warn).not.toHaveBeenCalled();
  });

  /**
   * EL FALLO PRINCIPAL DEL ISSUE #27.
   *
   * El comentario de scopeToOwnPartner promete que un partner_id "en body o
   * query" se sobreescribe con el del token. El body si. La query no se toca.
   *
   * Las cuatro rutas de /api/v1/public/* son GET, que es justo por donde viaja
   * el partner_id. Hoy no hay fuga porque los controladores son stubs 501, pero
   * el primero que lea req.query.partner_id en vez de req.scopedPartnerId abre
   * el agujero sin que nada lo impida.
   *
   * Es tambien la primera tarea del gate #36.
   */
  it.fails('deberia neutralizar tambien el partner_id de la query', () => {
    const req = fakeReq({ identity: identidad(), query: { partner_id: '2002' } });
    correr(scopeToOwnPartner(), req, fakeRes());

    // En Express 5 req.query es de solo lectura, asi que la salida probablemente
    // no sea sobreescribir sino responder 400. Cualquiera de las dos vale;
    // lo que no vale es dejar el valor ajeno intacto.
    expect(String(req.query.partner_id)).toBe('1001');
  });

  it('sin logger el intento cruzado NO rompe el request, pero se pierde', () => {
    // req.log es opcional (`req.log?.warn`). Si pino-http no esta montado en
    // algun camino, el evento de auditoria desaparece en silencio.
    //
    // El gate #36 exige "verificar que cada intento queda registrado como acceso
    // cruzado en los logs". Un registro de seguridad no deberia depender de que
    // otro middleware este presente. Este test fija el comportamiento actual
    // para que el dia que se arregle, alguien lo vea aqui.
    const req = fakeReq({ identity: identidad(), query: { partner_id: '2002' } });

    expect(() => correr(scopeToOwnPartner(), req, fakeRes())).not.toThrow();
    expect(req.scopedPartnerId).toBe(1001);
  });

  it.fails('deberia denegar limpiamente si falta la identidad', () => {
    // scopeToOwnPartner accede a req.identity.odooPartnerId sin optional
    // chaining, al contrario que requireScope. Si el orden de middleware se
    // rompe, sale un TypeError -> 500 con traza, en vez de un 401.
    const req = fakeReq({ query: { partner_id: '2002' } });

    expect(() => correr(scopeToOwnPartner(), req, fakeRes())).not.toThrow();
  });

  it('un body sin partner_id no gana la propiedad de la nada... la gana', () => {
    // Documenta un efecto lateral: aunque el cliente no mande partner_id, el
    // middleware se lo inyecta al body. Es intencionado (los controladores
    // pueden confiar en que esta) pero conviene tenerlo fijado por escrito.
    const req = fakeReq({ identity: identidad(), body: { cantidad: 3 } });
    correr(scopeToOwnPartner(), req, fakeRes());

    expect(req.body.partner_id).toBe(1001);
    expect(req.body.cantidad).toBe(3);
  });
});
