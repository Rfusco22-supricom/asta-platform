import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import '../config/dotenv.js';
import { firmarEnlace, ocultarTokenDeUrl, TTL_ENLACE_SEGUNDOS, verificarEnlace } from '../services/enlacesFirmados.js';

/**
 * #32 · Firma de los enlaces de descarga.
 *
 * La descarga no pide API key: lo que la autoriza es esta firma. Cualquier forma
 * de fabricar o alterar un token que pase `verificarEnlace` es una descarga de
 * facturas ajenas sin credenciales.
 */

const AHORA = 1_800_000_000;
const DATOS = { facturaId: 100, adjuntoId: 200, partnerId: 300, apiKeyId: '11111111-2222-4333-8444-555555555555' };

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('#32 · verificarEnlace', () => {
  it('un enlace recién firmado verifica y devuelve lo firmado', () => {
    const { token, expira } = firmarEnlace(DATOS, AHORA);
    expect(expira).toBe(AHORA + TTL_ENLACE_SEGUNDOS);
    expect(verificarEnlace(token, AHORA)).toEqual({ ok: true, contenido: { ...DATOS, expira } });
  });

  it('cambiar la factura con la firma original → FIRMA_INVALIDA', () => {
    const { token } = firmarEnlace(DATOS, AHORA);
    const [, firma] = token.split('.');
    const alterado = `${b64({ f: 999, a: 200, p: 300, k: DATOS.apiKeyId, exp: AHORA + 300 })}.${firma}`;
    expect(verificarEnlace(alterado, AHORA)).toEqual({ ok: false, motivo: 'FIRMA_INVALIDA' });
  });

  it('alargar la caducidad con la firma original → FIRMA_INVALIDA', () => {
    const { token } = firmarEnlace(DATOS, AHORA);
    const [, firma] = token.split('.');
    const alterado = `${b64({ f: 100, a: 200, p: 300, k: DATOS.apiKeyId, exp: AHORA + 86_400 })}.${firma}`;
    expect(verificarEnlace(alterado, AHORA)).toEqual({ ok: false, motivo: 'FIRMA_INVALIDA' });
  });

  it('una firma hecha con otra clave → FIRMA_INVALIDA', () => {
    const cuerpo = b64({ f: 100, a: 200, p: 300, k: DATOS.apiKeyId, exp: AHORA + 300 });
    const firma = createHmac('sha256', 'no-es-la-clave').update(cuerpo).digest('base64url');
    expect(verificarEnlace(`${cuerpo}.${firma}`, AHORA)).toEqual({ ok: false, motivo: 'FIRMA_INVALIDA' });
  });

  it('una firma hecha con el pepper SIN derivar → FIRMA_INVALIDA', () => {
    // La clave de los enlaces se deriva con HKDF: quien consiga el pepper en
    // crudo de otro uso no puede firmar enlaces con él directamente.
    const cuerpo = b64({ f: 100, a: 200, p: 300, k: DATOS.apiKeyId, exp: AHORA + 300 });
    const firma = createHmac('sha256', process.env.API_KEY_PEPPER ?? '').update(cuerpo).digest('base64url');
    expect(verificarEnlace(`${cuerpo}.${firma}`, AHORA)).toEqual({ ok: false, motivo: 'FIRMA_INVALIDA' });
  });

  it('firma truncada, vacía o de otra longitud → FIRMA_INVALIDA o MALFORMADO, nunca ok', () => {
    const { token } = firmarEnlace(DATOS, AHORA);
    const [cuerpo, firma] = token.split('.');
    for (const t of [`${cuerpo}.${firma.slice(0, -2)}`, `${cuerpo}.`, `${cuerpo}.AAAA`, `${cuerpo}.${firma}AA`]) {
      expect(verificarEnlace(t, AHORA).ok).toBe(false);
    }
  });

  it('formas de JWT y basura → MALFORMADO', () => {
    const { token } = firmarEnlace(DATOS, AHORA);
    for (const t of ['', '.', 'abc', `${token}.x`, `eyJhbGciOiJub25lIn0.${token}`, 'a b.c', '../../etc.passwd']) {
      expect(verificarEnlace(t, AHORA)).toEqual({ ok: false, motivo: expect.stringMatching(/MALFORMADO|FIRMA_INVALIDA/) });
    }
  });

  it('caduca exactamente al llegar a `expira`', () => {
    const { token, expira } = firmarEnlace(DATOS, AHORA);
    expect(verificarEnlace(token, expira - 1).ok).toBe(true);
    expect(verificarEnlace(token, expira)).toEqual({ ok: false, motivo: 'CADUCADO' });
  });
});

describe('#32 · ocultarTokenDeUrl', () => {
  it('el token no llega al log; el resto de la URL sí', () => {
    const { token } = firmarEnlace(DATOS, AHORA);
    const oculta = ocultarTokenDeUrl(`/api/v1/descargas/facturas/${token}?x=1`);
    expect(oculta).toBe('/api/v1/descargas/facturas/[oculto]?x=1');
    expect(oculta).not.toContain(token.split('.')[1]);
  });

  it('no toca otras rutas', () => {
    expect(ocultarTokenDeUrl('/api/v1/public/invoices/5')).toBe('/api/v1/public/invoices/5');
  });
});
