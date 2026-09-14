import { describe, expect, it, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import type { Identity } from '@asta/shared-types';
import { requireScope, scopeToOwnPartner } from '../middleware/apiKeyAuth.js';
import { registerAuditSink, type AuditEvent } from '../services/audit.service.js';

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
 * Este fichero llego a tener `it.fails` fijando fallos reales de #27. Ya no
 * queda ninguno: el ultimo, el partner_id por query, se cerro con #36. Los casos
 * que los sustituyeron llevan una nota ARREGLADO.
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

  it('rechaza con 400 un partner_id ajeno que venga en el body', () => {
    // Antes lo corregia en silencio. Ahora se rechaza: ver el comentario de
    // scopeToOwnPartner sobre por que 400 y no corregirlo.
    const req = fakeReq({ identity: identidad(), body: { partner_id: 2002 } });
    const res = fakeRes();

    expect(correr(scopeToOwnPartner(), req, res)).toBe(false);
    expect(res.codigo).toBe(400);
    expect(res.cuerpo).toMatchObject({ error: { code: 'PARTNER_ID_NOT_ALLOWED' } });
    expect(req.scopedPartnerId).toBeUndefined();
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
   * ARREGLADO — era el fallo principal del issue #27, y la primera tarea de #36.
   *
   * El comentario de scopeToOwnPartner prometia que un partner_id "en body o
   * query" se sobreescribia con el del token. El body si; la query no se tocaba,
   * y las rutas de /api/v1/public/* son GET, que es justo por donde viaja.
   *
   * Aqui antes habia un `it.fails` con una nota que decia que en Express 5
   * `req.query` es de solo lectura. Era falso: el middleware usa Express 4, donde
   * `req.query` SI se puede escribir. La decision de responder 400 no se apoya
   * en eso, sino en que un partner_id ajeno merece un error y no una correccion
   * callada que oculte que alguien lo intento.
   */
  it('rechaza con 400 un partner_id ajeno que venga en la query', () => {
    const req = fakeReq({ identity: identidad(), query: { partner_id: '2002' } });
    const res = fakeRes();

    expect(correr(scopeToOwnPartner(), req, res)).toBe(false);
    expect(res.codigo).toBe(400);
    expect(res.cuerpo).toMatchObject({ error: { code: 'PARTNER_ID_NOT_ALLOWED' } });
    expect(req.scopedPartnerId).toBeUndefined();
  });

  it('el intento cruzado queda auditado aunque NO haya logger', () => {
    // Antes solo se registraba con `req.log?.warn`, que es opcional: sin pino-http
    // montado, el evento desaparecia en silencio. #36 exige que cada intento
    // quede registrado, asi que ahora pasa tambien por recordAudit().
    const eventos: AuditEvent[] = [];
    const quitar = registerAuditSink((e) => eventos.push(e));
    try {
      const req = fakeReq({ identity: identidad(), query: { partner_id: '2002' } });
      correr(scopeToOwnPartner(), req, fakeRes());

      expect(eventos).toHaveLength(1);
      expect(eventos[0]).toMatchObject({
        action: 'access.denied.partner',
        actorId: UUID_USER,
        targetType: 'res.partner',
        targetId: '2002',
        metadata: { via: 'api_key', apiKeyId: UUID_KEY },
      });
    } finally {
      quitar();
    }
  });

  it('un partner_id propio NO genera evento de auditoria', () => {
    const eventos: AuditEvent[] = [];
    const quitar = registerAuditSink((e) => eventos.push(e));
    try {
      const req = fakeReq({ identity: identidad(), query: { partner_id: '1001' } });
      expect(correr(scopeToOwnPartner(), req, fakeRes())).toBe(true);
      expect(eventos).toHaveLength(0);
    } finally {
      quitar();
    }
  });

  it('deniega con 401 si falta la identidad, sin reventar', () => {
    // ARREGLADO. Antes accedia a req.identity.odooPartnerId sin optional
    // chaining, al contrario que requireScope: montar este middleware sin
    // authApiKey() delante daba un TypeError -> 500 con traza.
    const req = fakeReq({ query: { partner_id: '2002' } });
    const res = fakeRes();

    let paso = true;
    expect(() => {
      paso = correr(scopeToOwnPartner(), req, res);
    }).not.toThrow();

    expect(paso).toBe(false);
    expect(res.codigo).toBe(401);
    expect(req.scopedPartnerId).toBeUndefined();
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
