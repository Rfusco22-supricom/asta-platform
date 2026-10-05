// Solo para poner el .env en process.env. No valida nada ni lanza (issue #9).
import '../config/dotenv.js';
import { prisma } from '../config/prisma.js';
import { evaluarTodo } from '../services/alerts.service.js';
import { avisar, consultarSalud, type ResultadoAvisos } from '../services/pasadaAlertas.service.js';

/**
 * `pnpm alertas` — comprueba el estado y avisa (issue #46).
 *
 * Pensado para un cron cada pocos minutos. En producción las alertas las corre
 * el propio middleware (`programarAlertas`, desde el 2026-10-05): EasyPanel no
 * tiene programador para el servicio. Esto sigue sirviendo para correrlas a
 * mano, o desde un cron externo, que es lo único que puede avisar de que el
 * middleware está caído.
 *
 * ── Por qué es un proceso aparte y no algo dentro del middleware ─────────────
 *
 * Porque la alerta más importante es "el middleware no responde", y esa no la
 * puede dar el propio middleware. Corriendo fuera, sigue avisando aunque el
 * servidor esté caído — que es justo cuando hace falta.
 *
 * ── Cómo llegan las alertas a alguien ────────────────────────────────────────
 *
 * Hoy salen por la salida estándar y el proceso termina con código 1 si hay algo
 * crítico. Eso ya sirve: cualquier cron decente manda por correo la salida de un
 * trabajo que falla, y un supervisor de procesos puede reaccionar al código.
 *
 * Además, a los canales configurados:
 *
 *   · `ALERTAS_CORREO`: direcciones separadas por comas. Necesita el SMTP de
 *     #53; sin él no se envía, y se dice.
 *   · `ALERTAS_WEBHOOK_URL`: cualquier webhook que acepte `{"text": "..."}`
 *     (Slack, Discord, Google Chat).
 *
 * A los canales NO va todo en cada pasada: solo lo que empieza, cambia de
 * gravedad o se resuelve, y un recordatorio cada `ALERTAS_RECORDATORIO_HORAS`
 * (4 por defecto) de lo que sigue. Ver `avisosAlertas.service.ts`. La salida
 * estándar sí lo enseña todo siempre.
 */

const VERDE = '\x1b[32m';
const ROJO = '\x1b[31m';
const AMARILLO = '\x1b[33m';
const GRIS = '\x1b[90m';
const FIN = '\x1b[0m';

const MIDDLEWARE_URL = process.env.MIDDLEWARE_URL ?? 'http://localhost:3001';

/** Lo que pasó con los avisos de esta pasada, en la salida estándar. */
function informarAvisos(r: ResultadoAvisos): void {
  for (const e of r.errores) console.error(`  (${e})`);
  if (r.sinNovedades) {
    console.log(`  ${GRIS}Sin novedades: nada que avisar (lo activo ya se avisó).${FIN}`);
    return;
  }
  const canal = (v: boolean | null) => (v === null ? 'sin configurar' : v ? 'enviado' : 'FALLÓ');
  console.log(
    `  ${GRIS}Avisos: ${r.cuenta.nueva} nuevas · ${r.cuenta.cambiada} cambiadas · ` +
      `${r.cuenta.recordatorio} recordatorios · ${r.cuenta.resuelta} resueltas` +
      ` → webhook ${canal(r.webhook)}, correo ${canal(r.correo)}.${FIN}`,
  );
  if (!r.entregado) console.log(`  ${AMARILLO}Ningún canal entregó: se volverá a intentar en la próxima pasada.${FIN}`);
}

async function main(): Promise<void> {
  const salud = await consultarSalud(MIDDLEWARE_URL);

  /*
   * Las reglas de base se evalúan SIEMPRE, incluso con el middleware caído.
   *
   * Son dos sistemas distintos: que el servidor no responda no dice nada sobre
   * si el sync está atrasado, y con el middleware caído es cuando más interesa
   * saber qué más está roto. Si MySQL tampoco responde, se recoge como fallo y
   * se informa abajo.
   *
   * La composición vive en `evaluarTodo` y no aquí: así los tests pueden
   * comprobar el orden y la combinación sin levantar un servidor ni un cron.
   */
  const { alertas, fallos } = await evaluarTodo(salud);

  // ── Informe ───────────────────────────────────────────────────────────────
  const criticas = alertas.filter((a) => a.severidad === 'critica');
  const avisos = alertas.filter((a) => a.severidad === 'aviso');

  console.log(`\n  ${new Date().toISOString()}  ·  ${MIDDLEWARE_URL}\n`);

  if (alertas.length === 0) {
    /*
     * «Sin alertas» en verde SOLO si de verdad se pudo mirar todo.
     *
     * Con MySQL inalcanzable fallan las siete reglas de base y la pasada termina
     * sin alertas: un verde ahí, con la lista de fallos debajo, se lee de un
     * vistazo como que todo va bien. Es la lectura falsa que este comando existe
     * para evitar, y la tenía él.
     */
    console.log(
      fallos.length === 0
        ? `  ${VERDE}Sin alertas.${FIN}`
        : `  ${AMARILLO}Ninguna alerta, pero ${fallos.length} regla(s) no se pudieron evaluar:${FIN}\n` +
          `  ${AMARILLO}esto NO significa que todo esté bien.${FIN}`,
    );
    if (salud.latencia?.p95 !== null && salud.latencia?.p95 !== undefined) {
      console.log(
        `  ${GRIS}Odoo p95 ${salud.latencia.p95} ms sobre ${salud.latencia.muestras} llamadas.${FIN}`,
      );
    }
  } else {
    for (const a of alertas) {
      const color = a.severidad === 'critica' ? ROJO : AMARILLO;
      const etiqueta = a.severidad === 'critica' ? 'CRÍTICA' : 'aviso  ';
      console.log(`  ${color}${etiqueta}${FIN}  ${a.titulo}`);
      console.log(`            ${a.detalle}`);
      console.log(`            ${GRIS}${a.runbook}${FIN}\n`);
    }
  }

  if (fallos.length > 0) {
    // Una regla que no se puede evaluar NO es una regla que pasa. Se dice.
    console.log(`  ${AMARILLO}Reglas que no se pudieron evaluar:${FIN}`);
    for (const f of fallos) console.log(`    · ${f}`);
    console.log('');
  }

  informarAvisos(await avisar(alertas, fallos.length > 0));
  await prisma.$disconnect();

  const plural = (n: number, una: string, varias: string) =>
    `${n} ${n === 1 ? una : varias}`;

  console.log(
    `  ${plural(criticas.length, 'crítica', 'críticas')} · ` +
      `${plural(avisos.length, 'aviso', 'avisos')} · ` +
      `${fallos.length} sin evaluar\n`,
  );

  // Solo las críticas hacen fallar el trabajo. Un aviso que devuelve error
  // convierte el cron en una fuente de correos que se filtran a la papelera, y
  // entonces el día de la crítica tampoco la lee nadie.
  if (criticas.length > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
