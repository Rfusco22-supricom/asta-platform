import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import '../config/dotenv.js';
import { prisma } from '../config/prisma.js';
import { resetEnvCache } from '../config/env.js';
import { revisarEntorno } from '../config/validarEntorno.js';
import { issueApiKey, keysPendientesDeRotacion, revokeApiKey, verifyApiKey } from '../services/apiKey.service.js';
import { firmarEnlace, verificarEnlace } from '../services/enlacesFirmados.js';

/**
 * #45 · Rotación de `API_KEY_PEPPER` con doble pepper.
 *
 * La promesa de docs/08-ROTACION-PEPPER.md es que rotar NO obliga a reemitir las
 * keys: con `API_KEY_PEPPER_ANTERIOR`, cada una pasa al pepper nuevo en su primer
 * uso. Y que los enlaces de PDF, en cambio, se cortan en el acto. Aquí se prueban
 * las dos mitades, contra MySQL real, cambiando el entorno como se cambiaría en
 * EasyPanel.
 */

const PEPPER_ORIGINAL = process.env.API_KEY_PEPPER;
const ANTERIOR_ORIGINAL = process.env.API_KEY_PEPPER_ANTERIOR;
const A = 'A'.repeat(40);
const B = 'B'.repeat(40);
const PARTNER_FICTICIO = 999_000_451;

let userId = '';
const keysCreadas: string[] = [];

/** Deja el entorno como quedaría tras un despliegue con estas variables. */
function desplegar(pepper: string, anterior?: string): void {
  process.env.API_KEY_PEPPER = pepper;
  if (anterior === undefined) delete process.env.API_KEY_PEPPER_ANTERIOR;
  else process.env.API_KEY_PEPPER_ANTERIOR = anterior;
  resetEnvCache();
}

const hmac = (pepper: string, token: string) => createHmac('sha256', pepper).update(token).digest('hex');

async function hashGuardado(id: string): Promise<string> {
  return (await prisma.apiKey.findUniqueOrThrow({ where: { id }, select: { keyHash: true } })).keyHash;
}

async function nuevaKey(nombre = 'rotación') {
  const k = await issueApiKey({ userId, name: nombre, scopes: ['INVOICES_READ'] });
  keysCreadas.push(k.id);
  return k;
}

/** `last_used_at` se escribe después de responder: hay que esperarlo. */
async function esperarUso(id: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const k = await prisma.apiKey.findUniqueOrThrow({ where: { id }, select: { lastUsedAt: true } });
    if (k.lastUsedAt) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`last_used_at de ${id} no llegó`);
}

beforeAll(async () => {
  const u = await prisma.appUser.create({
    data: { email: 'test.rotacion@pepper.local', fullName: 'Rotación', role: 'BRONCE', odooPartnerId: PARTNER_FICTICIO, isActive: true },
  });
  userId = u.id;
});

afterEach(() => {
  desplegar(A);
});

afterAll(async () => {
  await prisma.apiKey.deleteMany({ where: { id: { in: keysCreadas } } });
  await prisma.appUser.deleteMany({ where: { id: userId } });
  if (PEPPER_ORIGINAL === undefined) delete process.env.API_KEY_PEPPER;
  else process.env.API_KEY_PEPPER = PEPPER_ORIGINAL;
  if (ANTERIOR_ORIGINAL === undefined) delete process.env.API_KEY_PEPPER_ANTERIOR;
  else process.env.API_KEY_PEPPER_ANTERIOR = ANTERIOR_ORIGINAL;
  resetEnvCache();
  await prisma.$disconnect();
});

describe('#45 · Las keys sobreviven a la rotación', () => {
  it('SIN pepper anterior, rotar invalida la key (lo que pasaba antes)', async () => {
    desplegar(A);
    const k = await nuevaKey();
    desplegar(B);
    expect(await verifyApiKey(k.plaintext)).toMatchObject({ ok: false, reason: 'NOT_FOUND', apiKeyId: k.id });
  });

  it('CON pepper anterior, la key funciona y en ese uso pasa al pepper nuevo', async () => {
    desplegar(A);
    const k = await nuevaKey();
    expect(await hashGuardado(k.id)).toBe(hmac(A, k.plaintext));

    desplegar(B, A);
    expect((await verifyApiKey(k.plaintext)).ok).toBe(true);
    expect(await hashGuardado(k.id)).toBe(hmac(B, k.plaintext));

    // Y al cerrar la ventana sigue funcionando: ya no depende del anterior.
    desplegar(B);
    expect((await verifyApiKey(k.plaintext)).ok).toBe(true);
  });

  it('una key que NO se usó en la ventana deja de funcionar al cerrarla', async () => {
    desplegar(A);
    const k = await nuevaKey();
    desplegar(B, A);
    desplegar(B);
    expect(await verifyApiKey(k.plaintext)).toMatchObject({ ok: false, reason: 'NOT_FOUND' });
  });

  it('una key creada durante la ventana nace con el pepper nuevo', async () => {
    desplegar(B, A);
    const k = await nuevaKey();
    expect(await hashGuardado(k.id)).toBe(hmac(B, k.plaintext));
  });

  it('un secreto equivocado no migra nada ni se acepta con ningún pepper', async () => {
    desplegar(A);
    const k = await nuevaKey();
    const antes = await hashGuardado(k.id);
    const falso = `${k.plaintext.slice(0, -4)}ZZZZ`;

    desplegar(B, A);
    expect(await verifyApiKey(falso)).toMatchObject({ ok: false, reason: 'NOT_FOUND', apiKeyId: k.id });
    expect(await hashGuardado(k.id)).toBe(antes);
  });

  it('una key revocada sigue revocada, aunque migre', async () => {
    desplegar(A);
    const k = await nuevaKey();
    await revokeApiKey({ apiKeyId: k.id, actorId: userId, duenoEsperado: userId, reason: 'test #45' });

    desplegar(B, A);
    expect(await verifyApiKey(k.plaintext)).toMatchObject({ ok: false, reason: 'REVOKED' });
  });

  it('dos peticiones simultáneas durante la ventana: las dos pasan y la key queda con el nuevo', async () => {
    desplegar(A);
    const k = await nuevaKey();
    desplegar(B, A);
    const [r1, r2] = await Promise.all([verifyApiKey(k.plaintext), verifyApiKey(k.plaintext)]);
    expect(r1.ok && r2.ok).toBe(true);
    expect(await hashGuardado(k.id)).toBe(hmac(B, k.plaintext));
  });

  it('volver atrás INTERCAMBIANDO los valores no deja fuera a las que ya migraron', async () => {
    // Es lo que dice el runbook: intercambiar, no vaciar.
    desplegar(A);
    const k = await nuevaKey();
    desplegar(B, A);
    await verifyApiKey(k.plaintext); // migra a B

    desplegar(A, B);
    expect((await verifyApiKey(k.plaintext)).ok).toBe(true);

    // Y vaciar habría sido un error: la key ya estaba de vuelta en A, así que
    // se prueba con una que se quede en B.
    desplegar(A);
    const otra = await nuevaKey('rollback');
    desplegar(B, A);
    await verifyApiKey(otra.plaintext); // migra a B
    desplegar(A);
    expect((await verifyApiKey(otra.plaintext)).ok).toBe(false);
  });
});

describe('#45 · Los enlaces de PDF se cortan en el acto', () => {
  const datos = { facturaId: 1, adjuntoId: 2, partnerId: 3, apiKeyId: '11111111-2222-4333-8444-555555555555' };

  it('un enlace firmado con el pepper anterior NO vale durante la ventana', () => {
    // A propósito: si se rota porque el pepper se filtró, lo que hay que cerrar
    // ya es la posibilidad de firmar enlaces.
    desplegar(A);
    const { token } = firmarEnlace(datos);
    desplegar(B, A);
    expect(verificarEnlace(token)).toEqual({ ok: false, motivo: 'FIRMA_INVALIDA' });
  });

  it('uno firmado con el nuevo sí', () => {
    desplegar(B, A);
    const { token } = firmarEnlace(datos);
    expect(verificarEnlace(token).ok).toBe(true);
  });
});

describe('#45 · keysPendientesDeRotacion', () => {
  it('lista exactamente las activas que existían al rotar y no se usaron desde entonces', async () => {
    desplegar(A);
    const sinUsar = await nuevaKey('sin usar');
    const usada = await nuevaKey('usada');
    const revocada = await nuevaKey('revocada');
    await revokeApiKey({ apiKeyId: revocada.id, actorId: userId, duenoEsperado: userId });
    const caducada = await nuevaKey('caducada');
    await prisma.apiKey.update({ where: { id: caducada.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    await new Promise((r) => setTimeout(r, 20));
    const desde = new Date();
    await new Promise((r) => setTimeout(r, 20));

    desplegar(B, A);
    expect((await verifyApiKey(usada.plaintext)).ok).toBe(true);
    await esperarUso(usada.id);
    const nueva = await nuevaKey('creada tras rotar');

    // Solo las de este caso: las keys de los tests anteriores también están
    // activas y sin usar, y es correcto que salgan.
    const deEsteCaso = new Set([sinUsar.id, usada.id, revocada.id, caducada.id, nueva.id]);
    const pendientes = (await keysPendientesDeRotacion(desde)).filter((p) => deEsteCaso.has(p.id));
    expect(pendientes.map((p) => p.id)).toEqual([sinUsar.id]);

    // Las que NO salen, y por qué: comprobado contra el hash, no contra la lista.
    expect(await hashGuardado(usada.id)).toBe(hmac(B, usada.plaintext));
    expect(await hashGuardado(nueva.id)).toBe(hmac(B, nueva.plaintext));
    expect(await hashGuardado(sinUsar.id)).toBe(hmac(A, sinUsar.plaintext));
  });

  it('el identificador es el que muestra «Mis API keys», sin el secreto', async () => {
    desplegar(A);
    const k = await nuevaKey('identificador');
    await new Promise((r) => setTimeout(r, 20));
    const [p] = (await keysPendientesDeRotacion(new Date())).filter((x) => x.id === k.id);
    expect(p.identificador).toBe(`asta_live_${k.prefix}…${k.lastFour}`);
    expect(p.identificador).not.toContain(k.plaintext.slice(-43, -4));
    expect(p.email).toBe('test.rotacion@pepper.local');
  });
});

describe('#45 · Entorno', () => {
  const base = () => ({
    DATABASE_URL: 'mysql://x@localhost/x',
    API_KEY_PEPPER: B,
    ODOO_URL: 'https://ejemplo.odoo.com',
    ODOO_DB: 'db',
    ODOO_USERNAME: 'u@ejemplo.com',
    ODOO_PASSWORD: 'p',
    JWT_SECRET: 'y'.repeat(32),
  });

  it('vacía cuenta como no puesta: un .env copiado de .env.example arranca', () => {
    expect(revisarEntorno({ ...base(), API_KEY_PEPPER_ANTERIOR: '' })).toEqual([]);
  });

  it('igual al pepper actual → no arranca, y nombra la variable', () => {
    const problemas = revisarEntorno({ ...base(), API_KEY_PEPPER_ANTERIOR: B });
    expect(problemas).toEqual([expect.objectContaining({ variable: 'API_KEY_PEPPER_ANTERIOR' })]);
  });

  it('demasiado corta → no arranca', () => {
    expect(revisarEntorno({ ...base(), API_KEY_PEPPER_ANTERIOR: 'corta' })).toEqual([
      expect.objectContaining({ variable: 'API_KEY_PEPPER_ANTERIOR' }),
    ]);
  });
});
