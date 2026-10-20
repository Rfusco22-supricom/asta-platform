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
