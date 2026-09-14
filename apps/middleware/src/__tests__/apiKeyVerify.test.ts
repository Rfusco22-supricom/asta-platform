import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { issueApiKey, revokeApiKey, verifyApiKey } from '../services/apiKey.service.js';
import { authApiKey } from '../middleware/apiKeyAuth.js';

/**
 * Issue #27 — `verifyApiKey` y `authApiKey`, contra la base de datos real.
 *
 * La otra mitad (`requireScope`, `scopeToOwnPartner`) vive en apiKeyAuth.test.ts
 * y no necesita base: son middleware puro. Estos si, porque `verifyApiKey`
 * resuelve la key contra `api_keys` y sus dos tablas puente.
 *
 * Las fixtures se crean y se destruyen aqui, con un `odoo_partner_id` en un
 * rango que no existe en Odoo (999.000.xxx) para no chocar nunca con el espejo
 * que sincroniza el job de #15.
 *
 * Los tres fallos que este fichero destapo —la lista blanca fallando abierta
 * sin IP, fallando cerrada con rangos CIDR, y el token rechazado por un espacio
 * de mas— ya estan arreglados, asi que aqui no queda ningun `it.fails`. Los
 * casos correspondientes llevan una nota ARREGLADO explicando que cubrian.
 */

const PARTNER_OK = 999_000_101;
const PARTNER_INACTIVO = 999_000_102;
const EMAIL_OK = 'test-apikey-ok@asta.invalid';
const EMAIL_INACTIVO = 'test-apikey-inactivo@asta.invalid';

let userId = '';
let userInactivoId = '';

let tokenValido = '';
let tokenRevocado = '';
let tokenExpirado = '';
let tokenInactivo = '';
let tokenConIpExacta = '';
let tokenConCidr = '';

/**
 * Ids de las keys de fixture. Desde #29, un rechazo de una key cuyo prefijo existe
 * devuelve a qué key iba (`apiKeyId`), para que `api_request_logs` pueda
 * atribuirlo. Estos tests fijan que se atribuye a la key CORRECTA.
 */
const ids = { valida: '', revocada: '', expirada: '', inactiva: '', conIp: '', conCidr: '' };

async function limpiar() {
  // Las keys, scopes e IPs caen por ON DELETE CASCADE al borrar el usuario.
  await prisma.appUser.deleteMany({
    where: { email: { in: [EMAIL_OK, EMAIL_INACTIVO] } },
  });
}

beforeAll(async () => {
  await limpiar();

  const user = await prisma.appUser.create({
    data: {
      email: EMAIL_OK,
      fullName: 'Cliente de prueba (API key)',
      role: 'BRONCE',
      odooPartnerId: PARTNER_OK,
      odooPricelistId: 15866,
      isActive: true,
    },
    select: { id: true },
  });
  userId = user.id;

  const inactivo = await prisma.appUser.create({
    data: {
      email: EMAIL_INACTIVO,
      fullName: 'Cliente dado de baja',
      role: 'BRONCE',
      odooPartnerId: PARTNER_INACTIVO,
      isActive: false,
    },
    select: { id: true },
  });
  userInactivoId = inactivo.id;

  const valida = await issueApiKey({
    userId,
    name: 'valida',
    scopes: ['INVENTORY_READ', 'PRICING_READ'],
  });
  tokenValido = valida.plaintext;
  ids.valida = valida.id;

  const revocada = await issueApiKey({ userId, name: 'revocada', scopes: ['INVENTORY_READ'] });
  tokenRevocado = revocada.plaintext;
  ids.revocada = revocada.id;
  await revokeApiKey(revocada.id, userId, 'test');

  const expirada = await issueApiKey({
    userId,
    name: 'expirada',
    scopes: ['INVENTORY_READ'],
    expiresInDays: -1,
  });
  tokenExpirado = expirada.plaintext;
  ids.expirada = expirada.id;

  const inactiva = await issueApiKey({
    userId: userInactivoId,
    name: 'de usuario inactivo',
    scopes: ['INVENTORY_READ'],
  });
  tokenInactivo = inactiva.plaintext;
  ids.inactiva = inactiva.id;

  const conIp = await issueApiKey({ userId, name: 'ip exacta', scopes: ['INVENTORY_READ'] });
  tokenConIpExacta = conIp.plaintext;
  ids.conIp = conIp.id;
  await prisma.apiKeyAllowedIp.create({ data: { apiKeyId: conIp.id, cidr: '200.44.1.10' } });

  const conCidr = await issueApiKey({ userId, name: 'cidr', scopes: ['INVENTORY_READ'] });
  tokenConCidr = conCidr.plaintext;
  ids.conCidr = conCidr.id;
  await prisma.apiKeyAllowedIp.create({ data: { apiKeyId: conCidr.id, cidr: '200.44.1.0/24' } });
});

afterAll(async () => {
  await limpiar();
  await prisma.$disconnect();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('#27 · verifyApiKey · formato del token', () => {
  it('acepta una key recien emitida y devuelve la identidad del dueno', async () => {
    const r = await verifyApiKey(tokenValido);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.identity.odooPartnerId).toBe(PARTNER_OK);
    expect(r.identity.appUserId).toBe(userId);
    expect(r.identity.role).toBe('BRONCE');
    expect([...r.identity.scopes].sort()).toEqual(['INVENTORY_READ', 'PRICING_READ']);
  });

  it('el token emitido lleva la marca visible que detectan los escaneres', () => {
    // `asta_live_` en claro es deliberado: permite que el escaner de secretos de
    // GitHub lo reconozca si un cliente lo sube a un repo publico.
    expect(tokenValido).toMatch(/^asta_live_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/);
  });

  it('rechaza un token con forma invalida sin tocar la base', async () => {
    const r = await verifyApiKey('esto-no-es-un-token');
    expect(r).toEqual({ ok: false, reason: 'MALFORMED' });
  });

  it('rechaza un prefijo bien formado que no existe', async () => {
    const r = await verifyApiKey(`asta_live_deadbeef_${'A'.repeat(43)}`);
    expect(r).toEqual({ ok: false, reason: 'NOT_FOUND' });
  });

  it('rechaza el secreto equivocado aunque el prefijo sea real', async () => {
    // Mismo prefijo, secreto cambiado: es el caso que protege el HMAC.
    const prefijo = tokenValido.split('_')[2];
    const r = await verifyApiKey(`asta_live_${prefijo}_${'B'.repeat(43)}`);
    // Hacia fuera es un NOT_FOUND como cualquier otro. Pero el prefijo es real:
    // el intento iba contra ESTA key, y queda atribuido para la alerta key-401.
    expect(r).toEqual({ ok: false, reason: 'NOT_FOUND', apiKeyId: ids.valida });
  });

  it('un token TEST no vale contra una key LIVE', async () => {
    // El hash cubre el token entero, incluido `asta_live_`, asi que cambiar el
    // entorno rompe la verificacion aunque el prefijo y el secreto coincidan.
    const r = await verifyApiKey(tokenValido.replace('asta_live_', 'asta_test_'));
    expect(r.ok).toBe(false);
  });

  /**
   * BUG NUEVO, no estaba en la revision inicial del #27.
   *
   * `verifyApiKey` valida el formato sobre el token RECORTADO:
   *
   *     const match = TOKEN_REGEX.exec(rawToken.trim());
   *
   * pero calcula el HMAC sobre el ORIGINAL:
   *
   *     const candidate = Buffer.from(hashToken(rawToken), 'utf8');
   *
   * Ese `.trim()` demuestra la intencion de tolerar espacios. Con la
   * inconsistencia, un token con un salto de linea o un espacio de sobra
   * —copiado a un .env, a un curl o a un gestor de secretos— pasa la
   * comprobacion de formato y luego falla como NOT_FOUND, indistinguible de
   * una key equivocada. El cliente ve "API key invalida o revocada" ante una
   * key que es perfectamente valida, y no tiene forma de averiguarlo.
   *
   * El arreglo es de una linea: recortar una vez y usar ese valor para ambas
   * cosas.
   */
  it('tolera espacios alrededor del token', async () => {
    const r = await verifyApiKey(`  ${tokenValido}  `);
    expect(r.ok).toBe(true);
  });

  it('tolera un salto de linea al final, que es el caso real', async () => {
    // Pegar un secreto largo en un .env, un curl o un gestor de secretos se
    // lleva un \n con muchisima facilidad.
    const r = await verifyApiKey(`${tokenValido}\n`);
    expect(r.ok).toBe(true);
  });
});

describe('#27 · verifyApiKey · ciclo de vida', () => {
  it('rechaza una key revocada', async () => {
    const r = await verifyApiKey(tokenRevocado);
    expect(r).toEqual({ ok: false, reason: 'REVOKED', apiKeyId: ids.revocada });
  });

  it('rechaza una key caducada', async () => {
    const r = await verifyApiKey(tokenExpirado);
    expect(r).toEqual({ ok: false, reason: 'EXPIRED', apiKeyId: ids.expirada });
  });

  it('rechaza la key de un usuario dado de baja', async () => {
    // Desactivar al usuario invalida sus keys sin tener que revocarlas una a una.
    const r = await verifyApiKey(tokenInactivo);
    expect(r).toEqual({ ok: false, reason: 'USER_INACTIVE', apiKeyId: ids.inactiva });
  });

  it('revocar deja rastro en audit_logs', async () => {
    const eventos = await prisma.auditLog.findMany({
      where: { action: 'api_key.revoked', actorId: userId },
      select: { id: true },
    });
    expect(eventos.length).toBeGreaterThan(0);
  });
});

describe('#27 · verifyApiKey · lista blanca de IPs', () => {
  it('acepta la IP exacta declarada', async () => {
    const r = await verifyApiKey(tokenConIpExacta, '200.44.1.10');
    expect(r.ok).toBe(true);
  });

  it('rechaza una IP que no esta en la lista', async () => {
    const r = await verifyApiKey(tokenConIpExacta, '8.8.8.8');
    expect(r).toEqual({ ok: false, reason: 'IP_NOT_ALLOWED', apiKeyId: ids.conIp });
  });

  it('una key SIN lista blanca acepta cualquier origen', async () => {
    const r = await verifyApiKey(tokenValido, '8.8.8.8');
    expect(r.ok).toBe(true);
  });

  /**
   * FALLA ABIERTA — punto 1 de la revision del #27.
   *
   * La comprobacion es `allowedIps.length > 0 && ip && !allowedIps.includes(ip)`.
   * Cuando `ip` viene undefined, el `&& ip &&` salta la condicion entera y la
   * key se acepta. Una allowlist tiene que fallar CERRADA: si hay lista y no se
   * puede determinar el origen, se rechaza.
   */
  it('rechaza cuando hay lista blanca y no se conoce la IP', async () => {
    // ARREGLADO. Antes el `&& ip &&` saltaba la condicion entera y aceptaba la
    // key: una allowlist se volvia inutil justo cuando no se podia determinar
    // el origen. Ahora falla cerrada.
    const r = await verifyApiKey(tokenConIpExacta, undefined);
    expect(r).toEqual({ ok: false, reason: 'IP_NOT_ALLOWED', apiKeyId: ids.conIp });
  });

  /**
   * FALLA CERRADA CON RANGOS — el otro medio del punto 1.
   *
   * El esquema documenta la columna como CIDR:
   *
   *     /// "200.44.1.10" o "200.44.1.0/24"
   *     cidr String @db.VarChar(45)
   *
   * pero el codigo compara con `includes(ip)`, que es igualdad exacta de
   * cadenas. Con "200.44.1.0/24" guardado, NINGUNA IP del rango coincide: se
   * rechaza todo el rango mientras el operador cree que la lista funciona.
   *
   * La salida es implementar comparacion CIDR de verdad, o renombrar la columna
   * a `ip` y documentar que solo admite direcciones exactas.
   */
  it('acepta una IP dentro del rango CIDR declarado', async () => {
    // ARREGLADO. Antes se comparaba con includes(), igualdad exacta de cadenas,
    // asi que "200.44.1.0/24" no coincidia con ninguna IP del rango.
    const r = await verifyApiKey(tokenConCidr, '200.44.1.77');
    expect(r.ok).toBe(true);
  });

  it('rechaza una IP fuera del rango CIDR', async () => {
    const r = await verifyApiKey(tokenConCidr, '200.44.2.77');
    expect(r).toEqual({ ok: false, reason: 'IP_NOT_ALLOWED', apiKeyId: ids.conCidr });
  });

  it('acepta una IPv4 que llega envuelta como ::ffff:', async () => {
    // Node entrega esa forma cuando el socket es IPv6 y el cliente vino por
    // IPv4, que es lo habitual detras de un proxy. Sin desenvolverla, la lista
    // blanca no casaria nunca en produccion.
    const r = await verifyApiKey(tokenConCidr, '::ffff:200.44.1.77');
    expect(r.ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

type ResEspia = Response & { codigo: number | null; cuerpo: unknown };

function fakeRes(): ResEspia {
  // `locals` existe siempre en Express. Sin él, `authApiKey` lanzaba al anotar
  // la key rechazada y el doble no se parecía a una respuesta real.
  const res: Record<string, unknown> = { codigo: null, cuerpo: undefined, locals: {} };
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

function fakeReq(headers: Record<string, string>, ip?: string): Request {
  const normalizados = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    query: {},
    ip,
    get: (name: string) => normalizados[name.toLowerCase()],
  } as unknown as Request;
}

async function correr(req: Request, res: Response) {
  let paso = false;
  const next: NextFunction = () => {
    paso = true;
  };
  await (authApiKey() as unknown as (r: Request, s: Response, n: NextFunction) => Promise<void>)(
    req,
    res,
    next,
  );
  return paso;
}

describe('#27 · authApiKey', () => {
  it('sin cabecera responde 401 MISSING_API_KEY', async () => {
    const res = fakeRes();
    expect(await correr(fakeReq({}), res)).toBe(false);
    expect(res.codigo).toBe(401);
    expect(res.cuerpo).toMatchObject({ error: { code: 'MISSING_API_KEY' } });
  });

  it('acepta el token por X-API-Key y deja la identidad en req', async () => {
    const req = fakeReq({ 'x-api-key': tokenValido });
    const res = fakeRes();

    expect(await correr(req, res)).toBe(true);
    expect(res.codigo).toBeNull();
    expect(req.identity.odooPartnerId).toBe(PARTNER_OK);
  });

  it('acepta tambien Authorization: Bearer', async () => {
    const req = fakeReq({ authorization: `Bearer ${tokenValido}` });
    const res = fakeRes();

    expect(await correr(req, res)).toBe(true);
    expect(req.identity.odooPartnerId).toBe(PARTNER_OK);
  });

  it('X-API-Key gana sobre Authorization si llegan las dos', async () => {
    const req = fakeReq({ 'x-api-key': tokenValido, authorization: 'Bearer basura' });
    const res = fakeRes();

    expect(await correr(req, res)).toBe(true);
  });

  it('da el MISMO 401 para revocada, caducada e inexistente', async () => {
    // Es la propiedad que impide usar la API como oraculo: un atacante no puede
    // distinguir "esta key no existe" de "existe pero esta revocada".
    const cuerpos: unknown[] = [];
    for (const t of [tokenRevocado, tokenExpirado, `asta_live_deadbeef_${'A'.repeat(43)}`]) {
      const res = fakeRes();
      await correr(fakeReq({ 'x-api-key': t }), res);
      expect(res.codigo).toBe(401);
      cuerpos.push(res.cuerpo);
    }
    expect(cuerpos[0]).toEqual(cuerpos[1]);
    expect(cuerpos[1]).toEqual(cuerpos[2]);
  });

  it('registra el motivo real solo en el log, no en la respuesta', async () => {
    const warn = vi.fn();
    const req = fakeReq({ 'x-api-key': tokenRevocado });
    (req as { log?: unknown }).log = { warn, error: vi.fn() };
    const res = fakeRes();

    await correr(req, res);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatchObject({ reason: 'REVOKED' });
    expect(JSON.stringify(res.cuerpo)).not.toContain('REVOKED');
  });

  it('una credencial Basic acaba tratada como API key malformada', async () => {
    // El `.replace(/^Bearer\s+/i, '')` no hace nada si el esquema no es Bearer,
    // asi que "Basic dXNlcjpwYXNz" entra tal cual al TOKEN_REGEX. No es una
    // vulnerabilidad, pero ensucia los logs de rechazo y confunde a quien
    // integra: el 401 dice "API key invalida" ante algo que ni lo pretendia.
    const res = fakeRes();
    expect(await correr(fakeReq({ authorization: 'Basic dXNlcjpwYXNz' }), res)).toBe(false);
    expect(res.cuerpo).toMatchObject({ error: { code: 'INVALID_API_KEY' } });
  });
});
