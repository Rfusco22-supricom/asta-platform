import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { olvidarCorreoEnv } from '../config/correoEnv.js';
import { correoConfigurado, enviarCorreo, plantillaInvitacion, plantillaReseteo, viaDelCorreo } from '../services/correo.service.js';

/**
 * #53 · El correo por n8n, como los avisos del panel de Supricom.
 *
 * Lo que se vigila:
 *
 *   · con CORREO_WEBHOOK_URL manda el webhook, aunque haya SMTP;
 *   · al webhook solo viajan los DATOS (nombre, enlace, caducidad), nunca el
 *     correo armado: el texto lo pone n8n, y así un webhook público no sirve
 *     para mandar cualquier cosa desde la cuenta de la empresa;
 *   · si n8n lo rechaza o no contesta, `enviado: false` y nada se cae;
 *   · una plantilla sin datos no sale por el webhook.
 */

const URL_N8N = 'https://n8n.example/webhook/asta-correo';
const entornoPrevio = { ...process.env };
let llamadas: Array<{ url: string; cuerpo: Record<string, unknown> }> = [];
let respuesta: () => Promise<Response> = async () => new Response('{"enviado":true}', { status: 200 });

beforeEach(() => {
  process.env.CORREO_WEBHOOK_URL = URL_N8N;
  process.env.SMTP_HOST = 'smtp.example';
  olvidarCorreoEnv();
  llamadas = [];
  respuesta = async () => new Response('{"enviado":true}', { status: 200 });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    llamadas.push({ url: String(url), cuerpo: JSON.parse(String(init?.body)) });
    return respuesta();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...entornoPrevio };
  olvidarCorreoEnv();
});

describe('#53 · Correo por n8n', () => {
  it('manda el webhook, aunque haya SMTP', () => {
    expect(viaDelCorreo()).toBe('n8n');
    expect(correoConfigurado()).toBe(true);
  });

  it('el reseteo viaja como datos, no como correo armado', async () => {
    const r = await enviarCorreo(plantillaReseteo({ para: 'ana@cliente.com', nombre: 'Ana', url: 'https://panel.example/restablecer/abc', minutos: 60, esPersonal: false }));
    expect(r).toEqual({ enviado: true });
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]!.url).toBe(URL_N8N);
    expect(llamadas[0]!.cuerpo).toEqual({ plantilla: 'reseteo', para: 'ana@cliente.com', nombre: 'Ana', enlace: 'https://panel.example/restablecer/abc', minutos: 60, esPersonal: false });
  });

  it('la invitación también', async () => {
    await enviarCorreo(plantillaInvitacion({ para: 'luis@cliente.com', nombre: 'Luis', url: 'https://panel.example/invitacion/xyz', dias: 7 }));
    expect(llamadas[0]!.cuerpo).toEqual({ plantilla: 'invitacion', para: 'luis@cliente.com', nombre: 'Luis', enlace: 'https://panel.example/invitacion/xyz', dias: 7 });
  });

  it('si n8n lo rechaza o no contesta: enviado false, sin caerse', async () => {
    respuesta = async () => new Response('{"error":"enlace no permitido"}', { status: 422 });
    expect(await enviarCorreo(plantillaInvitacion({ para: 'x@y.com', nombre: 'X', url: 'https://otro.example/', dias: 7 }))).toEqual({ enviado: false });

    respuesta = async () => {
      throw new TypeError('fetch failed');
    };
    expect(await enviarCorreo(plantillaInvitacion({ para: 'x@y.com', nombre: 'X', url: 'https://panel.example/', dias: 7 }))).toEqual({ enviado: false });
  });

  it('una plantilla sin datos no sale por el webhook', async () => {
    const r = await enviarCorreo({ para: 'ops@supricom.com.ve', asunto: 'a', texto: 't', html: '<p>t</p>', plantilla: 'alertas' });
    expect(r).toEqual({ enviado: false });
    expect(llamadas).toHaveLength(0);
  });
});
