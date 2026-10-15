/**
 * ¿Sale el correo? ¿Llega el webhook de alertas? (#46, #53)
 *
 * Dentro del contenedor del middleware:
 *
 *   node dist/cli/probar-correo.js                      conecta y se autentica, sin enviar nada
 *   node dist/cli/probar-correo.js --enviar a@b.com     además manda un correo de prueba
 *   node dist/cli/probar-correo.js --webhook            manda un aviso de prueba a ALERTAS_WEBHOOK_URL
 *
 * Con CORREO_WEBHOOK_URL el correo sale por n8n (como el panel de Supricom) y el
 * SMTP no se usa: `--enviar` prueba esa vía, y solo a direcciones de supricom.
 *
 * Existe porque el fallo solo se veía en el log como «fallo al enviar el correo,
 * codigo 535», cuando una alerta ya se había perdido. El mismo SMTP manda los
 * reseteos de contraseña y las invitaciones: si falla, tampoco llegan.
 *
 * La contraseña nunca se imprime: solo si está, cuánto mide y si trae espacios
 * o comillas, que es como suele llegar mal pegada desde EasyPanel.
 */
import '../config/dotenv.js';
import { correoEnv } from '../config/correoEnv.js';
import { correoConfigurado, enviarCorreo, verificarCorreo, viaDelCorreo } from '../services/correo.service.js';

const arg = (nombre: string) => {
  const i = process.argv.indexOf(nombre);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

/** «no-reply@supricom.com.ve» → «no…@supricom.com.ve». */
const tapar = (email: string | undefined) => (email ? email.replace(/^(.{2}).*@/, '$1…@') : '(vacío)');

function describirClave(clave: string | undefined): string {
  if (!clave) return '(vacía)';
  const avisos = [
    /^["'].*["']$/.test(clave) ? 'ENTRE COMILLAS: quítalas en EasyPanel' : '',
    /\s/.test(clave) ? 'con espacios (Google las enseña en bloques de 4; también valen sin ellos)' : '',
    clave.replace(/\s/g, '').length !== 16 ? `mide ${clave.replace(/\s/g, '').length} sin espacios: una contraseña de aplicación de Google mide 16` : '',
  ].filter(Boolean);
  return `${clave.length} caracteres${avisos.length ? ` · ${avisos.join(' · ')}` : ''}`;
}

async function probarWebhook(): Promise<void> {
  const url = process.env.ALERTAS_WEBHOOK_URL;
  if (!url) {
    console.log('  webhook: ALERTAS_WEBHOOK_URL está vacía. Ponle la URL de un webhook de Google Chat, Slack o Discord.');
    return;
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '✅ *Prueba de alertas de ASTA*\nSi lees esto, las alertas del middleware llegan a este canal.' }),
      signal: AbortSignal.timeout(10_000),
    });
    console.log(res.ok ? `  webhook: entregado (HTTP ${res.status}). Mira el canal.` : `  webhook: el destino contestó HTTP ${res.status}. Revisa la URL.`);
  } catch (error) {
    console.log(`  webhook: no se pudo conectar (${error instanceof Error ? error.message : 'error'}).`);
  }
}

async function main(): Promise<void> {
  const e = correoEnv();
  console.log('\n  correo saliente (SMTP)\n');
  console.log(`  SMTP_HOST      ${e.SMTP_HOST ?? '(vacío: no se envía nada)'}`);
  console.log(`  SMTP_PORT      ${e.SMTP_PORT}`);
  console.log(`  SMTP_USER      ${tapar(e.SMTP_USER)}`);
  console.log(`  SMTP_PASSWORD  ${describirClave(process.env.SMTP_PASSWORD)}`);
  console.log(`  SMTP_FROM      ${tapar(e.SMTP_FROM)}${e.SMTP_USER && e.SMTP_FROM.split('@')[1] !== e.SMTP_USER.split('@')[1] ? '  ← distinto dominio que SMTP_USER' : ''}`);
  console.log(`  CORREO_WEBHOOK_URL ${e.CORREO_WEBHOOK_URL ?? '(vacía: el correo sale por SMTP)'}`);
  console.log(`  ALERTAS_CORREO ${(process.env.ALERTAS_CORREO ?? '').split(',').filter((x) => x.trim()).map((x) => tapar(x.trim())).join(', ') || '(vacío: las alertas no van por correo)'}`);
  console.log('');

  const via = viaDelCorreo();
  const para = arg('--enviar');
  const prueba = (destino: string) =>
    enviarCorreo({
      para: destino,
      asunto: 'Prueba de correo de ASTA',
      texto: 'Si lees esto, el correo saliente del middleware funciona: alertas, reseteos de contraseña e invitaciones.',
      html: '<p>Si lees esto, el correo saliente del middleware funciona: alertas, reseteos de contraseña e invitaciones.</p>',
      plantilla: 'prueba',
      datos: {},
    });

  if (!correoConfigurado()) {
    console.log('  Ni CORREO_WEBHOOK_URL ni SMTP_HOST: no sale ningún correo.');
  } else if (via === 'n8n') {
    console.log('  el correo sale por n8n (CORREO_WEBHOOK_URL); el SMTP no se usa.');
    if (para) {
      const r = await prueba(para);
      console.log(r.enviado ? `  correo de prueba: n8n lo envió a ${tapar(para)}. Mira la bandeja (y la de spam).` : '  correo de prueba: n8n no lo envió; mira el log del middleware (motivo) y las ejecuciones del flujo en n8n.');
    } else console.log('  Para probarlo: --enviar <tu correo @supricom>');
  } else {
    const v = await verificarCorreo();
    if (v.ok) console.log('  conexión y autenticación: OK');
    else {
      console.log(`  conexión y autenticación: FALLA · ${v.codigo}${v.motivo ? ` · ${v.motivo}` : ''}`);
      if (v.pista) console.log(`\n  → ${v.pista}`);
    }
    if (v.ok && para) {
      const r = await prueba(para);
      console.log(r.enviado ? `  correo de prueba: enviado a ${tapar(para)}. Mira la bandeja (y la de spam).` : '  correo de prueba: no salió; mira el log del middleware.');
    }
  }

  if (process.argv.includes('--webhook')) {
    console.log('');
    await probarWebhook();
  }
  console.log('');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
