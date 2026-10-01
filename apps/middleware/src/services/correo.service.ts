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
  plantilla: 'reseteo' | 'invitacion' | 'alertas';
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

/** Lo que necesita la plantilla de alertas de cada aviso (#46). */
export interface AvisoParaCorreo {
  tipo: 'nueva' | 'cambiada' | 'recordatorio' | 'resuelta';
  severidad: string;
  titulo: string;
  detalle: string;
  /** Enlace completo al runbook. */
  enlace: string;
  desde: Date;
}

const ETIQUETA_AVISO: Record<AvisoParaCorreo['tipo'], string> = {
  nueva: 'NUEVA',
  cambiada: 'CAMBIÓ DE GRAVEDAD',
  recordatorio: 'SIGUE ACTIVA',
  resuelta: 'RESUELTA',
};

/**
 * Un correo con todos los avisos de una pasada. El asunto dice lo grave primero:
 * es lo único que se lee en la bandeja.
 */
export function plantillaAlertas(para: string, avisos: AvisoParaCorreo[]): Correo {
  const criticas = avisos.filter((a) => a.tipo !== 'resuelta' && a.severidad === 'critica').length;
  const resueltas = avisos.filter((a) => a.tipo === 'resuelta').length;
  const abiertas = avisos.length - resueltas;
  const partes = [
    criticas ? `${criticas} crítica${criticas === 1 ? '' : 's'}` : '',
    abiertas - criticas ? `${abiertas - criticas} aviso${abiertas - criticas === 1 ? '' : 's'}` : '',
    resueltas ? `${resueltas} resuelta${resueltas === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  const asunto = `[ASTA] ${criticas ? '🔴' : abiertas ? '🟡' : '✅'} ${partes.join(' · ')}`;

  const hora = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const lineaTexto = (a: AvisoParaCorreo) =>
    [
      `${ETIQUETA_AVISO[a.tipo]} · ${a.tipo === 'resuelta' ? '' : a.severidad === 'critica' ? 'CRÍTICA · ' : 'aviso · '}${a.titulo}`,
      a.detalle,
      a.tipo === 'nueva' ? '' : `Activa desde ${hora(a.desde)}.`,
      `Qué hacer: ${a.enlace}`,
    ]
      .filter(Boolean)
      .join('\n');

  const texto = [...avisos.map(lineaTexto), '', 'Comprobador de alertas de ASTA (#46). Avisa cuando algo empieza, cambia o se resuelve, y recuerda cada pocas horas lo que sigue.'].join('\n\n');

  const color = (a: AvisoParaCorreo) => (a.tipo === 'resuelta' ? '#1a7f37' : a.severidad === 'critica' ? '#cf222e' : '#9a6700');
  const html = `<!doctype html><html lang="es"><body style="margin:0;padding:24px;background:#f4f5f7;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1d2433">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:24px">
<p style="margin:0 0 16px;font-weight:700;font-size:18px;color:#0b6bcb">asta · alertas</p>
${avisos
  .map(
    (a) => `<div style="border-left:4px solid ${color(a)};padding:8px 12px;margin:0 0 14px">
<p style="margin:0;font-size:12px;font-weight:700;color:${color(a)}">${escapar(ETIQUETA_AVISO[a.tipo])}${a.tipo === 'resuelta' ? '' : a.severidad === 'critica' ? ' · CRÍTICA' : ' · aviso'}</p>
<p style="margin:4px 0;font-weight:600">${escapar(a.titulo)}</p>
${a.detalle ? `<p style="margin:4px 0;line-height:1.45">${escapar(a.detalle)}</p>` : ''}
${a.tipo === 'nueva' ? '' : `<p style="margin:4px 0;font-size:12.5px;color:#6b7280">Activa desde ${escapar(hora(a.desde))}.</p>`}
<p style="margin:6px 0 0"><a href="${escapar(a.enlace)}" style="color:#0b6bcb">Qué hacer</a></p>
</div>`,
  )
  .join('\n')}
<p style="margin:16px 0 0;font-size:12px;color:#6b7280">Comprobador de alertas de ASTA (#46). Avisa cuando algo empieza, cambia o se resuelve, y recuerda cada pocas horas lo que sigue.</p>
</div></body></html>`;

  return { para, asunto, texto, html, plantilla: 'alertas' };
}
