import nodemailer from 'nodemailer';
import { correoEnv } from '../config/correoEnv.js';
import { logger } from '../utils/logger.js';

/**
 * Correo saliente: invitaciones y reseteo de contraseña (#53).
 *
 * ── Lo que nunca sale por el log ─────────────────────────────────────────────
 *
 * Ni el cuerpo ni el enlace: el enlace de un correo de reseteo ES la credencial
 * durante una hora, y uno de invitación durante siete días. Tampoco la
 * dirección: es un dato personal, y para depurar basta con saber qué plantilla
 * salió y si salió. Es la misma regla que el `set-cookie` del login.
 *
 * ── Sin SMTP no es un error ──────────────────────────────────────────────────
 *
 * `enviarCorreo` devuelve `{ enviado: false }` y quien llama decide. Las
 * invitaciones siguen pudiendo entregarse a mano; el reseteo simplemente no
 * llega, y la respuesta al usuario es la misma de siempre (ver
 * `reseteo.service.ts`).
 */

export interface Correo {
  para: string;
  asunto: string;
  texto: string;
  html: string;
  /** Solo para el log: qué plantilla es. */
  plantilla: 'reseteo' | 'invitacion';
}

/** Lo único que se usa de un transporte de nodemailer. Lo implementan los tests. */
export interface Transporte {
  sendMail(m: { from: string; to: string; subject: string; text: string; html: string }): Promise<unknown>;
}

let transporte: Transporte | null = null;
let transporteDePrueba: Transporte | null = null;

/** Solo para tests: sustituye el SMTP por uno que guarda lo enviado. `null` lo quita. */
export function usarTransporteDePrueba(t: Transporte | null): void {
  transporteDePrueba = t;
}

export function correoConfigurado(): boolean {
  return Boolean(transporteDePrueba || correoEnv().SMTP_HOST);
}

function transporteReal(): Transporte {
  if (transporte) return transporte;
  const e = correoEnv();
  transporte = nodemailer.createTransport({
    host: e.SMTP_HOST,
    port: e.SMTP_PORT,
    // 465 es TLS directo; 587 empieza en claro y sube con STARTTLS, que se exige.
    secure: e.SMTP_PORT === 465,
    requireTLS: e.SMTP_PORT !== 465,
    auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASSWORD ?? '' } : undefined,
  });
  return transporte;
}

export async function enviarCorreo(c: Correo): Promise<{ enviado: boolean }> {
  if (!correoConfigurado()) {
    logger.info({ correo: c.plantilla }, 'correo no enviado: sin SMTP configurado');
    return { enviado: false };
  }
  try {
    await (transporteDePrueba ?? transporteReal()).sendMail({
      from: correoEnv().SMTP_FROM,
      to: c.para,
      subject: c.asunto,
      text: c.texto,
      html: c.html,
    });
    logger.info({ correo: c.plantilla }, 'correo enviado');
    return { enviado: true };
  } catch (error) {
    // El mensaje de error del SMTP no lleva el cuerpo, pero puede llevar la
    // dirección («550 user unknown <x@y>»): solo el código.
    const codigo = (error as { code?: string; responseCode?: number }).responseCode ?? (error as { code?: string }).code ?? 'desconocido';
    logger.error({ correo: c.plantilla, codigo }, 'fallo al enviar el correo');
    return { enviado: false };
  }
}

// ── Plantillas ──────────────────────────────────────────────────────────────

const escapar = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** Un correo sencillo: texto plano para quien no ve HTML, y el mismo contenido en HTML. */
function componer(parrafos: string[], boton: { texto: string; url: string }, pie: string): { texto: string; html: string } {
  const texto = [...parrafos, '', `${boton.texto}: ${boton.url}`, '', pie].join('\n');
  const html = `<!doctype html><html lang="es"><body style="margin:0;padding:24px;background:#f4f5f7;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1d2433">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:28px">
<p style="margin:0 0 18px;font-weight:700;font-size:20px;color:#0b6bcb">asta</p>
${parrafos.map((p) => `<p style="margin:0 0 14px;line-height:1.5">${escapar(p)}</p>`).join('\n')}
<p style="margin:22px 0"><a href="${escapar(boton.url)}" style="display:inline-block;background:#0b6bcb;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${escapar(boton.texto)}</a></p>
<p style="margin:0;font-size:12.5px;color:#6b7280;line-height:1.5">${escapar(pie)}</p>
</div></body></html>`;
  return { texto, html };
}

export function plantillaReseteo(d: { para: string; nombre: string; url: string; minutos: number; esPersonal: boolean }): Correo {
  const { texto, html } = componer(
    [
      `Hola, ${d.nombre}.`,
      'Alguien ha pedido restablecer la contraseña de tu cuenta del panel de ASTA. Si fuiste tú, usa el enlace de abajo para elegir una nueva.',
      ...(d.esPersonal ? ['Recuerda que también puedes entrar con tu usuario y contraseña de Odoo.'] : []),
    ],
    { texto: 'Elegir contraseña nueva', url: d.url },
    `El enlace caduca en ${d.minutos} minutos y solo sirve una vez. Al usarlo se cerrarán las sesiones abiertas. Si no lo pediste, ignora este correo: tu contraseña no cambia.`,
  );
  return { para: d.para, asunto: 'Restablecer tu contraseña de ASTA', texto, html, plantilla: 'reseteo' };
}

export function plantillaInvitacion(d: { para: string; nombre: string; url: string; dias: number }): Correo {
  const { texto, html } = componer(
    [`Hola, ${d.nombre}.`, 'Te han dado acceso al panel de ASTA. Para entrar, elige tu contraseña con el enlace de abajo.'],
    { texto: 'Elegir mi contraseña', url: d.url },
    `El enlace caduca en ${d.dias} días y solo sirve una vez. Si no esperabas este correo, puedes ignorarlo.`,
  );
  return { para: d.para, asunto: 'Tu acceso al panel de ASTA', texto, html, plantilla: 'invitacion' };
}
