/**
 * ¿Es seguro correr la batería de staging contra esta configuración? (#13)
 *
 * La batería de staging ESCRIBE: crea `sale.order` de verdad con el escritor
 * real (#33) y los cancela al terminar. Contra producción eso son pedidos reales
 * en el ERP. Por eso no basta con «poner otro .env»: esto se niega a arrancar si
 * hay la menor duda de que el Odoo o el MySQL son los de producción.
 *
 * Las reglas, todas obligatorias:
 *
 *   · `ODOO_STAGING=si`, escrito a propósito. Un `.env` copiado de otro sitio no
 *     lo trae.
 *   · `ODOO_DB` no es ninguna de `ODOO_DB_PRODUCCION`, y el host de `ODOO_URL` no
 *     es ninguno de `ODOO_HOST_PRODUCCION`. Los dos, porque en Odoo.sh el
 *     staging tiene otro host Y otra base, y basta con que uno coincida para
 *     que algo esté mal copiado.
 *   · `DATABASE_URL` apunta a localhost. La batería también escribe en MySQL.
 *
 * Los valores de producción tienen un valor por defecto, el de esta instalación
 * (medidos el 2026-10-01), para que la barrera funcione aunque nadie los
 * configure. Se pueden ampliar, nunca vaciar.
 */

export const DB_PRODUCCION_POR_DEFECTO = ['supricom-prod1-25424683'];
export const HOST_PRODUCCION_POR_DEFECTO = ['supricom2.odoo.com'];

const lista = (valor: string | undefined, porDefecto: string[]) => [
  ...new Set([...porDefecto, ...(valor ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)]),
];

function hostDe(url: string | undefined): string | null {
  try {
    return url ? new URL(url).hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

export interface Comprobacion {
  ok: boolean;
  /** Por qué no, en una línea por motivo. Vacío si `ok`. */
  motivos: string[];
}

export function comprobarStaging(env: Record<string, string | undefined>): Comprobacion {
  const motivos: string[] = [];

  if (env.ODOO_STAGING?.trim().toLowerCase() !== 'si') {
    motivos.push('Falta ODOO_STAGING=si: hay que decir a propósito que esto es staging.');
  }

  const db = env.ODOO_DB?.trim().toLowerCase();
  if (!db) motivos.push('Falta ODOO_DB.');
  else if (lista(env.ODOO_DB_PRODUCCION, DB_PRODUCCION_POR_DEFECTO).includes(db)) {
    motivos.push(`ODOO_DB=${env.ODOO_DB} es la base de PRODUCCIÓN.`);
  }

  const host = hostDe(env.ODOO_URL);
  if (!host) motivos.push('Falta ODOO_URL, o no es una URL.');
  else if (lista(env.ODOO_HOST_PRODUCCION, HOST_PRODUCCION_POR_DEFECTO).includes(host)) {
    motivos.push(`ODOO_URL apunta a ${host}, el Odoo de PRODUCCIÓN.`);
  }

  const mysql = hostDe(env.DATABASE_URL);
  if (!mysql) motivos.push('Falta DATABASE_URL, o no es una URL.');
  else if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(mysql)) {
    motivos.push(`DATABASE_URL apunta a ${mysql}: la batería de staging solo corre contra un MySQL local.`);
  }

  return { ok: motivos.length === 0, motivos };
}
