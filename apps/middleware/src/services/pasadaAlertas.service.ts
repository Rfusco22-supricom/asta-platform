import { evaluarTodo, type Alerta } from './alerts.service.js';
import { cargarEstados, decidirAvisos, guardarEstados, todoComoNuevo, type Aviso, type EstadoAlerta, type TipoAviso } from './avisosAlertas.service.js';
import { correoConfigurado, enviarCorreo, plantillaAlertas } from './correo.service.js';

/**
 * Una pasada de alertas (#46): mirar, decidir qué avisar, mandarlo y recordarlo.
 *
 * La usan las dos formas de correr las alertas:
 *
 *   · `cli/alertas.ts`, para un cron externo. Es la única que puede avisar de
 *     que el middleware está caído, porque corre fuera de él.
 *   · `programarCada` (programador.ts), dentro del propio middleware, cada pocos minutos. Es
 *     la de producción desde el 2026-10-05: EasyPanel no tiene programador de
 *     tareas para el servicio. El «middleware caído» lo cubre entonces un
 *     monitor externo de `/health` (ver `docs/05-RUNBOOKS.md`).
 */

export interface Salud {
  alcanzable: boolean;
  status?: string;
  detalle?: string;
  latencia?: { muestras: number; p95: number | null };
}

/**
 * Pregunta a `/health`.
 *
 * Con timeout propio: sin él, un middleware colgado —no caído, colgado— dejaría
 * la pasada esperando indefinidamente, y se acumularían hasta que el problema
 * fuera otro.
 */
export async function consultarSalud(baseUrl: string): Promise<Salud> {
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(10_000) });
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
     */
    const causa = (error as { cause?: { code?: string; message?: string } })?.cause;
    const motivo = causa?.code ?? causa?.message;
    const base = error instanceof Error ? error.message : 'sin respuesta';
    return { alcanzable: false, detalle: motivo ? `${base} (${motivo})` : base };
  }
}

/**
 * Enlace completo al runbook. En la terminal basta la ruta del repositorio; en
 * un correo hace falta algo que se pueda pulsar.
 */
export function enlaceRunbook(runbook: string): string {
  const base = process.env.ALERTAS_RUNBOOK_BASE ?? 'https://github.com/Rfusco22-supricom/asta-platform/blob/main/';
  return base.replace(/\/?$/, '/') + runbook;
}

const SIMBOLO: Record<TipoAviso, string> = { nueva: '', cambiada: '↕ ', recordatorio: '⏳ ', resuelta: '✅ ' };

/** `true` si llegó; `false` si falló. Sin URL configurada no hay nada que decir: `null`. */
async function enviarAlWebhook(avisos: Aviso[], errores: string[]): Promise<boolean | null> {
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
    // Que falle el aviso no puede tumbar la comprobación.
    errores.push(`no se pudo avisar al webhook: ${error instanceof Error ? error.message : 'error'}`);
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

export interface ResultadoAvisos {
  /** Nada que avisar: lo activo ya se avisó. */
  sinNovedades: boolean;
  cuenta: Record<TipoAviso, number>;
  webhook: boolean | null;
  correo: boolean | null;
  /** Algún canal entregó, o no hay ninguno y la salida estándar es el canal. */
  entregado: boolean;
  errores: string[];
}

/**
 * Decide qué toca avisar en esta pasada, lo manda y lo recuerda.
 *
 * El orden importa: primero se envía y DESPUÉS se guarda. Al revés, si fallara
 * el envío, el estado diría que ya se avisó y la alerta no volvería a salir
 * hasta el recordatorio. Y solo se guarda si algún canal entregó, o si no hay
 * ninguno configurado (entonces la salida estándar es el canal).
 */
export async function avisar(alertas: Alerta[], hayReglasSinEvaluar: boolean): Promise<ResultadoAvisos> {
  const ahora = new Date();
  const recordatorioMs = Number(process.env.ALERTAS_RECORDATORIO_HORAS ?? 4) * 3600_000;
  const errores: string[] = [];
  const cero = { nueva: 0, cambiada: 0, recordatorio: 0, resuelta: 0 };

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

  if (avisos.length === 0) return { sinNovedades: true, cuenta: cero, webhook: null, correo: null, entregado: true, errores };

  const [webhook, correo] = await Promise.all([enviarAlWebhook(avisos, errores), enviarPorCorreo(avisos)]);
  const canales = [webhook, correo].filter((r) => r !== null);
  const entregado = canales.length === 0 || canales.some((r) => r === true);
  const cuenta = { ...cero };
  for (const a of avisos) cuenta[a.tipo]++;

  if (entregado && conMemoria) {
    await guardarEstados(escribir).catch((e: unknown) => errores.push(`no se pudo guardar qué se avisó: ${e instanceof Error ? e.message : 'error'}`));
  }
  return { sinNovedades: false, cuenta, webhook, correo, entregado, errores };
}

export interface ResultadoPasada {
  alertas: Alerta[];
  fallos: string[];
  salud: Salud;
  avisos: ResultadoAvisos;
}

/** Una pasada entera: salud, reglas y avisos. */
export async function pasarAlertas(baseUrl: string): Promise<ResultadoPasada> {
  const salud = await consultarSalud(baseUrl);
  /*
   * Las reglas de base se evalúan SIEMPRE, incluso con el middleware caído: que
   * el servidor no responda no dice nada sobre si el sync está atrasado.
   */
  const { alertas, fallos } = await evaluarTodo(salud);
  const avisos = await avisar(alertas, fallos.length > 0);
  return { alertas, fallos, salud, avisos };
}

/** Una línea para el log del contenedor. */
export function resumirPasada(r: ResultadoPasada): string {
  const criticas = r.alertas.filter((a) => a.severidad === 'critica').length;
  const avisosN = r.alertas.length - criticas;
  const canal = (v: boolean | null) => (v === null ? 'sin configurar' : v ? 'enviado' : 'FALLÓ');
  const envio = r.avisos.sinNovedades
    ? 'sin novedades que avisar'
    : `avisos ${r.avisos.cuenta.nueva} nuevas · ${r.avisos.cuenta.cambiada} cambiadas · ${r.avisos.cuenta.recordatorio} recordatorios · ${r.avisos.cuenta.resuelta} resueltas → correo ${canal(r.avisos.correo)}, webhook ${canal(r.avisos.webhook)}`;
  return `alertas: ${criticas} críticas · ${avisosN} avisos · ${r.fallos.length} sin evaluar · ${envio}${r.avisos.errores.length ? ` · ${r.avisos.errores.join(' · ')}` : ''}`;
}
