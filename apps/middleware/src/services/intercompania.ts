type Clausula = [string, string, unknown];
type Dominio = Array<Clausula | '&' | '|' | '!'>;

/**
 * Las ventas entre empresas del grupo NO son ventas (decisión del 13-oct-2026).
 *
 * ── Por qué ──────────────────────────────────────────────────────────────────
 *
 * Valencia le factura mercancía a Caracas, y Caracas se la vende después al
 * cliente final. Contar las dos facturas cuenta dos veces la misma mercancía.
 * En septiembre de 2026, Valencia le facturó 11.384,00 de ASTA a «SUPRICOM CCS,
 * ASTA»: el panel decía 107.319,96 de ASTA en toda la empresa, y lo vendido a
 * clientes fue 95.935,96.
 *
 * ── Por qué ESTA lista ───────────────────────────────────────────────────────
 *
 * Es la del panel de SUPRICOM (Metas por marca y Stoplight, en el repo
 * Dashboard, `lib/intercompania.ts`), para que los dos paneles den la misma
 * cifra: comprobado contra Odoo, ASTA de septiembre de 2026 da 85.002,14 en
 * Valencia y 10.933,82 en Caracas en los dos. Si allí cambia la lista, hay que
 * cambiarla aquí.
 *
 * Un contacto es del grupo si su nombre lleva el de una empresa del grupo, si
 * su RIF es uno del grupo, o si es el contacto de una compañía de este Odoo. En
 * Odoo hay un «SUPRICOM CCS 21, C.A.» distinto en cada compañía, y ninguno es el
 * contacto de la compañía: por eso hace falta el nombre y el RIF, no solo
 * `ref_company_ids`. Los RIF van sin guiones porque en Odoo están escritos de
 * varias formas («J-31163115-1», «RUC155595002»).
 *
 * ── Cómo se aplica ───────────────────────────────────────────────────────────
 *
 * Por el cliente COMERCIAL de la factura, así que los contactos hijos también
 * quedan fuera. Con `not any` y no con `not in [ids]`: comprobado que da lo
 * mismo, y el dominio no crece con la lista. Eso importa porque `read_group`
 * repite el dominio entero en el `__domain` de cada grupo (ver
 * `gastoPorCliente` en `asta.service`). `not any` busca también entre los
 * contactos archivados, igual que la lista del otro panel.
 */

export const NOMBRES_DEL_GRUPO = ['supricom', 'office solutions center', 'ofimaster'];
export const RIFS_DEL_GRUPO = ['501193738', '31163115', '155595002', '1576706'];

/** Dominio de `res.partner`: los contactos de empresas del grupo. */
const ES_DEL_GRUPO: Dominio = [
  ...Array<'|'>(NOMBRES_DEL_GRUPO.length + RIFS_DEL_GRUPO.length).fill('|'),
  ...NOMBRES_DEL_GRUPO.map((n): Clausula => ['name', 'ilike', n]),
  ...RIFS_DEL_GRUPO.map((r): Clausula => ['vat', 'ilike', r]),
  ['ref_company_ids', '!=', false],
];

/** Para `account.move`: la factura no es a una empresa del grupo. */
export const SIN_INTERCOMPANIA: Clausula = ['commercial_partner_id', 'not any', ES_DEL_GRUPO];

/** Lo mismo para `account.move.line`, por el cliente comercial de su factura. */
export const SIN_INTERCOMPANIA_LINEA: Clausula = ['move_id.commercial_partner_id', 'not any', ES_DEL_GRUPO];

/** Para `sale.order`: el pedido no es de una empresa del grupo. */
export const SIN_INTERCOMPANIA_PEDIDO: Clausula = ['partner_id.commercial_partner_id', 'not any', ES_DEL_GRUPO];

/** Lo mismo para `sale.order.line`, por el cliente de su pedido. */
export const SIN_INTERCOMPANIA_LINEA_PEDIDO: Clausula = ['order_id.partner_id.commercial_partner_id', 'not any', ES_DEL_GRUPO];

/**
 * La misma regla para lo que no viene de Odoo (Smartbit), por el nombre y el
 * RIF que trae la fila. `ilike` es «contiene, sin mayúsculas»; el RIF se compara
 * sin signos, porque las cadenas de `RIFS_DEL_GRUPO` son solo dígitos.
 */
export function esDelGrupo(nombre: string | null | undefined, rif: string | null | undefined): boolean {
  const n = (nombre ?? '').toLowerCase();
  const r = (rif ?? '').replace(/[^0-9A-Za-z]/g, '');
  return NOMBRES_DEL_GRUPO.some((x) => n.includes(x)) || RIFS_DEL_GRUPO.some((x) => r.includes(x));
}
