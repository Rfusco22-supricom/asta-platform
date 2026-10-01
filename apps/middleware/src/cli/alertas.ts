// Solo para poner el .env en process.env. No valida nada ni lanza (issue #9).
import '../config/dotenv.js';
import { prisma } from '../config/prisma.js';
import { evaluarTodo, type Alerta } from '../services/alerts.service.js';
import { cargarEstados, decidirAvisos, guardarEstados, todoComoNuevo, type Aviso, type EstadoAlerta, type TipoAviso } from '../services/avisosAlertas.service.js';
import { correoConfigurado, enviarCorreo, plantillaAlertas } from '../services/correo.service.js';

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

/**
 * Enlace completo al runbook. En la terminal basta la ruta del repositorio; en
 * un correo hace falta algo que se pueda pulsar.
 */
function enlaceRunbook(runbook: string): string {
  const base = process.env.ALERTAS_RUNBOOK_BASE ?? 'https://github.com/Rfusco22-supricom/asta-platform/blob/main/';
  return base.replace(/\/?$/, '/') + runbook;
}

const SIMBOLO: Record<TipoAviso, string> = { nueva: '', cambiada: '↕ ', recordatorio: '⏳ ', resuelta: '✅ ' };

/** `true` si llegó; `false` si falló. Sin URL configurada no hay nada que decir: `null`. */
async function enviarAlWebhook(avisos: Aviso[]): Promise<boolean | null> {
  const url = process.env.ALERTAS_WEBHOOK_URL;
  if (!url) return null;

  const texto = avisos
    .map((a) => {
      const color = a.tipo === 'resuelta' ? '' : a.severidad === 'critica' ? '🔴 ' : '🟡 ';
      return `${SIMBOLO[a.tipo]}${color}*${a.titulo}*${a.tipo === 'resuelta' ? ' — resuelta' : ''}\n${a.detalle}\n${enlaceRunbook(a.runbook)}`.trim();
    })
    .join('\n\n');

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `text` es lo que entienden Slack, Discord y Google Chat sin configurar
      // nada más; `avisos` va al lado para quien quiera tratarlos como datos.
      body: JSON.stringify({ text: texto, avisos }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch (error) {
    // Que falle el aviso no puede tumbar la comprobación: las alertas ya se
    // imprimieron, y el código de salida sigue diciendo la verdad.
    console.error(`  (no se pudo avisar al webhook: ${error instanceof Error ? error.message : 'error'})`);
    return false;
  }
}

/** Las direcciones de `ALERTAS_CORREO`, separadas por comas. */
function destinatarios(): string[] {
  return (process.env.ALERTAS_CORREO ?? '')
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean);
}

/** `true` si salió; `false` si falló; `null` si no hay direcciones o no hay SMTP. */
async function enviarPorCorreo(avisos: Aviso[]): Promise<boolean | null> {
  const para = destinatarios();
  if (para.length === 0 || !correoConfigurado()) return null;
  const { enviado } = await enviarCorreo(
    plantillaAlertas(
      para.join(', '),
      avisos.map((a) => ({ tipo: a.tipo, severidad: a.severidad, titulo: a.titulo, detalle: a.detalle, enlace: enlaceRunbook(a.runbook), desde: a.desde })),
    ),
  );
  return enviado;
}

/**
 * Decide qué toca avisar en esta pasada, lo manda y lo recuerda.
 *
 * El orden importa: primero se envía y DESPUÉS se guarda. Al revés, si fallara
 * el envío, el estado diría que ya se avisó y la alerta no volvería a salir
 * hasta el recordatorio. Y solo se guarda si algún canal entregó, o si no hay
 * ninguno configurado (entonces la salida estándar es el canal).
 */
async function avisar(alertas: Alerta[], hayReglasSinEvaluar: boolean): Promise<void> {
  const ahora = new Date();
  const recordatorioMs = Number(process.env.ALERTAS_RECORDATORIO_HORAS ?? 4) * 3600_000;

  let avisos: Aviso[];
  let escribir: EstadoAlerta[] = [];
  let conMemoria = true;
  try {
    ({ avisos, escribir } = decidirAvisos(alertas, await cargarEstados(), { ahora, recordatorioMs, hayReglasSinEvaluar }));
  } catch {
    // Sin poder leer qué se avisó, se avisa de todo: repetir molesta, callar no.
    conMemoria = false;
    avisos = todoComoNuevo(alertas, ahora);
  }

  if (avisos.length === 0) {
    console.log(`  ${GRIS}Sin novedades: nada que avisar (lo activo ya se avisó).${FIN}`);
    return;
  }

  const [webhook, correo] = await Promise.all([enviarAlWebhook(avisos), enviarPorCorreo(avisos)]);
  const canales = [webhook, correo].filter((r) => r !== null);
  const entregado = canales.length === 0 || canales.some((r) => r === true);

  const cuenta = (t: TipoAviso) => avisos.filter((a) => a.tipo === t).length;
  console.log(
    `  ${GRIS}Avisos: ${cuenta('nueva')} nuevas · ${cuenta('cambiada')} cambiadas · ` +
      `${cuenta('recordatorio')} recordatorios · ${cuenta('resuelta')} resueltas` +
      ` → webhook ${webhook === null ? 'sin configurar' : webhook ? 'enviado' : 'FALLÓ'}` +
      `, correo ${correo === null ? 'sin configurar' : correo ? 'enviado' : 'FALLÓ'}.${FIN}`,
  );

  if (!entregado) {
    console.log(`  ${AMARILLO}Ningún canal entregó: se volverá a intentar en la próxima pasada.${FIN}`);
    return;
  }
  if (conMemoria) {
    await guardarEstados(escribir).catch((e: unknown) =>
      console.error(`  (no se pudo guardar qué se avisó: ${e instanceof Error ? e.message : 'error'})`),
    );
  }
}

async function main(): Promise<void> {
  const salud = await consultarSalud();

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

  await avisar(alertas, fallos.length > 0);
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
