/**
 * Meses «YYYY-MM»: sus nombres y su rango de fechas.
 *
 * Aparte de `components/Reporte.tsx` porque también los usa el gráfico mes a
 * mes, que es un componente de cliente: así no arrastra al navegador nada del
 * reporte del servidor.
 */

const CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const LARGOS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/** «2026-02» → «feb 26». */
export function etiquetaMes(periodo: string): string {
  const [anio, mes] = periodo.split('-');
  return `${CORTOS[Number(mes) - 1] ?? mes} ${anio.slice(2)}`;
}

/** «2026-02» → «Febrero 2026». */
export function nombreMes(periodo: string): string {
  const [anio, mes] = periodo.split('-');
  return `${LARGOS[Number(mes) - 1] ?? mes} ${anio}`;
}

/** «2026-02» → del 1 al 28 de febrero. `null` si no es un mes válido. */
export function rangoDeMes(periodo: string): { desde: string; hasta: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(periodo);
  if (!m) return null;
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) return null;
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  return { desde: `${periodo}-01`, hasta: `${periodo}-${String(ultimo).padStart(2, '0')}` };
}

const hoyIso = (hoy: Date) => hoy.toISOString().slice(0, 10);

/** El último día del mes de una fecha «YYYY-MM-DD». */
function finDeMes(fecha: string): string {
  return rangoDeMes(fecha.slice(0, 7))?.hasta ?? fecha;
}

/** «2026-11-03» → «3 nov 2026». */
function diaCorto(fecha: string): string {
  const [a, m, d] = fecha.split('-').map(Number) as [number, number, number];
  return `${d} ${CORTOS[m - 1]} ${a}`;
}

/** «2026-11» → «nov 2026». */
function mesCorto(periodo: string): string {
  const [a, m] = periodo.split('-').map(Number) as [number, number];
  return `${CORTOS[m - 1]} ${a}`;
}

/**
 * El periodo de unas cifras, dicho para que nadie tenga que adivinarlo:
 * «octubre 2026», «año 2025», «2026 hasta hoy», «nov 2025 – hoy»,
 * «nov 2025 – oct 2026».
 * Un rango que no empieza el día 1 o no acaba a fin de mes (o hoy), con fechas.
 */
export function nombrePeriodo(desde: string, hasta: string, hoy = new Date()): string {
  const enCurso = hasta === hoyIso(hoy);
  const empiezaMes = desde.endsWith('-01');
  const acabaMes = hasta === finDeMes(hasta) || enCurso;
  const hastaHoy = enCurso && hasta !== finDeMes(hasta) ? ' hasta hoy' : '';
  if (!empiezaMes || !acabaMes) return `${diaCorto(desde)} – ${diaCorto(hasta)}`;

  const [a1, a2] = [desde.slice(0, 4), hasta.slice(0, 4)];
  if (desde.slice(5) === '01-01' && a1 === a2 && (hasta.endsWith('-12-31') || enCurso)) {
    return hasta.endsWith('-12-31') ? `año ${a1}` : `${a1} hasta hoy`;
  }
  if (desde.slice(0, 7) === hasta.slice(0, 7)) return `${nombreMes(desde.slice(0, 7)).toLowerCase()}${hastaHoy}`;
  // Varios meses hasta hoy: «nov 2025 – hoy», que «– oct 2026 hasta hoy» se lee doble.
  return hastaHoy ? `${mesCorto(desde.slice(0, 7))} – hoy` : `${mesCorto(desde.slice(0, 7))} – ${mesCorto(hasta.slice(0, 7))}`;
}

/** Los últimos `n` meses «YYYY-MM», del más reciente al más antiguo. */
export function ultimosMeses(n: number, hoy = new Date()): string[] {
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
}

/** Un mes entero, o hasta hoy si es el mes en curso. */
export function rangoDelMes(periodo: string, hoy = new Date()): { desde: string; hasta: string } {
  const r = rangoDeMes(periodo)!;
  return { desde: r.desde, hasta: r.hasta > hoyIso(hoy) ? hoyIso(hoy) : r.hasta };
}

/** Un año entero, o hasta hoy si es el año en curso. */
export function rangoDelAnio(anio: number, hoy = new Date()): { desde: string; hasta: string } {
  const hasta = `${anio}-12-31`;
  return { desde: `${anio}-01-01`, hasta: hasta > hoyIso(hoy) ? hoyIso(hoy) : hasta };
}

/** La media mensual de unos meses «YYYY-MM» completos: «media de jun – sep 2026». */
export function mediaDe(meses: string[]): string {
  if (meses.length === 0) return 'media mensual';
  return `media de ${nombrePeriodo(`${meses[0]}-01`, rangoDeMes(meses.at(-1)!)!.hasta)}`;
}
