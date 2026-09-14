// Solo para poner el .env en process.env. No valida nada ni lanza (issue #9).
import '../apps/middleware/src/config/dotenv.js';
import { prisma } from '../apps/middleware/src/config/prisma.js';
import {
  evaluarReglasDeBase,
  reglaLatenciaOdoo,
  reglaSalud,
  type Alerta,
} from '../apps/middleware/src/services/alerts.service.js';

/**
 * `pnpm alertas` — comprueba el estado y avisa (issue #46).
 *
 * Pensado para un cron cada pocos minutos.
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
 * Si hay `ALERTAS_WEBHOOK_URL`, además se manda ahí como JSON. Vale para Slack,
 * Discord, Telegram por un puente, o lo que sea que el equipo lea de verdad.
 *
 * NO se manda por correo desde aquí: no hay SMTP configurado (es el bloqueo de
 * #53 y #16). Cuando lo haya, es un sumidero más, no una reescritura.
 */

const VERDE = '\x1b[32m';
const ROJO = '\x1b[31m';
const AMARILLO = '\x1b[33m';
const GRIS = '\x1b[90m';
const FIN = '\x1b[0m';

const MIDDLEWARE_URL = process.env.MIDDLEWARE_URL ?? 'http://localhost:3001';

interface Salud {
  alcanzable: boolean;
  status?: string;
  detalle?: string;
  latencia?: { muestras: number; p95: number | null };
}

/**
 * Pregunta a `/health`.
 *
 * Con timeout propio: sin él, un middleware colgado —no caído, colgado— dejaría
 * este script esperando indefinidamente, y el cron acumularía procesos hasta que
 * el problema fuera otro.
 */
async function consultarSalud(): Promise<Salud> {
  const corte = AbortSignal.timeout(10_000);

  try {
    const res = await fetch(`${MIDDLEWARE_URL}/health`, { signal: corte });
    const cuerpo = (await res.json()) as {
      status?: string;
      dependencias?: {
        odoo?: { ok?: boolean; error?: string; latencia?: { muestras: number; p95: number | null } };
        mysql?: { ok?: boolean; error?: string };
      };
    };

    const caidas = Object.entries(cuerpo.dependencias ?? {})
      .filter(([, d]) => d && (d as { ok?: boolean }).ok === false)
      .map(([nombre, d]) => `${nombre}: ${(d as { error?: string }).error ?? 'sin detalle'}`);

    return {
      alcanzable: true,
      status: cuerpo.status,
      detalle: caidas.length > 0 ? caidas.join(' · ') : undefined,
      latencia: cuerpo.dependencias?.odoo?.latencia,
    };
  } catch (error) {
    /*
     * El `fetch` de Node dice "fetch failed" y esconde el motivo en `cause`.
     *
     * A quien esté de guardia, "fetch failed" no le dice nada. La causa sí:
     * ECONNREFUSED es un proceso que no está, ETIMEDOUT o TimeoutError es un
     * proceso colgado o una red que no llega, ENOTFOUND es un nombre mal puesto.
     * Son tres problemas distintos con tres arreglos distintos.
     */
    const causa = (error as { cause?: { code?: string; message?: string } })?.cause;
    const motivo = causa?.code ?? causa?.message;
    const base = error instanceof Error ? error.message : 'sin respuesta';

    return {
      alcanzable: false,
      detalle: motivo ? `${base} (${motivo})` : base,
    };
  }
}

async function enviarAlWebhook(alertas: Alerta[]): Promise<void> {
  const url = process.env.ALERTAS_WEBHOOK_URL;
  if (!url || alertas.length === 0) return;

  const texto = alertas
    .map((a) => `${a.severidad === 'critica' ? '🔴' : '🟡'} *${a.titulo}*\n${a.detalle}\n${a.runbook}`)
    .join('\n\n');

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `text` es lo que entienden Slack y Discord sin configurar nada más;
      // `alertas` va al lado para quien quiera tratarlas como datos.
      body: JSON.stringify({ text: texto, alertas }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    // Que falle el aviso no puede tumbar la comprobación: las alertas ya se
    // imprimieron, y el código de salida sigue diciendo la verdad.
    console.error(
      `  (no se pudo avisar al webhook: ${error instanceof Error ? error.message : 'error'})`,
    );
  }
}

async function main(): Promise<void> {
  const salud = await consultarSalud();

  const alertas: Alerta[] = [];
  const fallos: string[] = [];

  const deSalud = reglaSalud(salud);
  if (deSalud) alertas.push(deSalud);

  if (salud.latencia) {
    const lenta = reglaLatenciaOdoo(salud.latencia);
    if (lenta) alertas.push(lenta);
  }

  /*
   * Las reglas de base se evalúan SIEMPRE, incluso con el middleware caído.
   *
   * Son dos sistemas distintos: que el servidor no responda no dice nada sobre
   * si el sync está atrasado, y con el middleware caído es cuando más interesa
   * saber qué más está roto. Si MySQL tampoco responde, `evaluarReglasDeBase`
   * lo recoge como fallo y se informa abajo.
   */
  const deBase = await evaluarReglasDeBase();
  alertas.push(...deBase.alertas);
  fallos.push(...deBase.fallos);

  // ── Informe ───────────────────────────────────────────────────────────────
  const criticas = alertas.filter((a) => a.severidad === 'critica');
  const avisos = alertas.filter((a) => a.severidad === 'aviso');

  console.log(`\n  ${new Date().toISOString()}  ·  ${MIDDLEWARE_URL}\n`);

  if (alertas.length === 0) {
    console.log(`  ${VERDE}Sin alertas.${FIN}`);
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

  await enviarAlWebhook(alertas);
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
