import { searchRead } from '../odoo/client.js';

/**
 * La tarifa de un cliente, leída como la lee Odoo al crearle un pedido.
 *
 * ── Por qué no basta con pedir `property_product_pricelist` ──────────────────
 *
 * Es un campo `property`: su valor DEPENDE DE LA COMPAÑÍA desde la que se lee.
 * Sin `allowed_company_ids`, Odoo responde con el de la compañía por defecto del
 * usuario de servicio —la 9—, y así se leía en todo el middleware. Medido el
 * 2026-09-24 sobre los 2.992 clientes:
 *
 *   compañía 10 → 1.074 clientes en `15863`, y se leían como `15866`
 *   compañía 7  → 1.023 clientes en `15836`/`15838`/`15839`, leídos como `15866`
 *   compañía 1  →    95 clientes en `1` (VEF), leídos como `15866`
 *   compañía 9  →   786 clientes en `15866`, los únicos bien leídos
 *
 * De ahí salió el «todos los clientes están en la misma tarifa» de #5, y de ahí
 * que `app_users.odooPricelistId` llevara la tarifa de la compañía 9 para dos
 * tercios de la cartera. Con ese dato, `/pricing` (#31) le habría servido a un
 * cliente de Supricom, S.A los precios de Office Solutions.
 *
 * ── Desde qué compañía ───────────────────────────────────────────────────────
 *
 * La del partner COMERCIAL, igual que `almacenDelCliente`: Odoo resuelve la
 * tarifa sobre la empresa, no sobre el contacto, y un pedido se crea en la
 * compañía que le vende. Un cliente sin compañía no tiene una tarifa definida
 * —cambia según desde dónde se mire—, y se devuelve `false`: mejor "sin tarifa"
 * que la de una compañía elegida al azar.
 *
 * ── Y no se puede agrupar ────────────────────────────────────────────────────
 *
 * Vive en `ir.property`, no en una columna: `read_group` sobre él falla con
 * "Cannot convert field to SQL" (Fase 0). Hay que leerlo registro a registro.
 */

export type TarifaLeida = [number, string] | false;

export interface TarifaConCompania {
  tarifa: TarifaLeida;
  /** Compañía del partner comercial, desde la que se leyó. `null` si no tiene. */
  companyId: number | null;
  /** El partner comercial: si cambia él, cambia la tarifa de todos sus contactos. */
  raizId: number;
}

/**
 * La tarifa de cada partner y la compañía desde la que se leyó.
 *
 * Coste: dos lecturas para resolver las compañías y una por compañía distinta
 * (hay 7), sea cual sea el número de partners.
 */
export async function leerTarifasConCompania(partnerIds: number[]): Promise<Map<number, TarifaConCompania>> {
  const resultado = new Map<number, TarifaConCompania>();
  if (partnerIds.length === 0) return resultado;

  const partners = await searchRead<{ id: number; commercial_partner_id: [number, string] | false }>(
    'res.partner',
    [['id', 'in', partnerIds]],
    ['commercial_partner_id'],
  );
  const raizDe = new Map(partners.map((p) => [p.id, p.commercial_partner_id ? p.commercial_partner_id[0] : p.id]));

  const raices = [...new Set(raizDe.values())];
  const comerciales = await searchRead<{ id: number; company_id: [number, string] | false }>(
    'res.partner',
    [['id', 'in', raices]],
    ['company_id'],
  );
  const companiaDe = new Map(comerciales.map((c) => [c.id, c.company_id ? c.company_id[0] : null]));

  const porCompania = new Map<number, number[]>();
  for (const id of partnerIds) {
    const raizId = raizDe.get(id) ?? id;
    const compania = companiaDe.get(raizId) ?? null;
    if (compania === null) {
      resultado.set(id, { tarifa: false, companyId: null, raizId });
      continue;
    }
    const grupo = porCompania.get(compania);
    if (grupo) grupo.push(id);
    else porCompania.set(compania, [id]);
  }

  for (const [compania, ids] of porCompania) {
    const filas = await searchRead<{ id: number; property_product_pricelist: TarifaLeida }>(
      'res.partner',
      [['id', 'in', ids]],
      ['property_product_pricelist'],
      // Sin `active_test: false`, a propósito: Odoo resuelve la tarifa buscando
      // entre las activas, y con él resucitaría una archivada (#31).
      { context: { allowed_company_ids: [compania] } },
    );
    for (const f of filas) resultado.set(f.id, { tarifa: f.property_product_pricelist, companyId: compania, raizId: raizDe.get(f.id) ?? f.id });
  }

  return resultado;
}

/** La tarifa de cada partner, leída desde la compañía de su partner comercial. */
export async function leerTarifas(partnerIds: number[]): Promise<Map<number, TarifaLeida>> {
  const conCompania = await leerTarifasConCompania(partnerIds);
  return new Map([...conCompania].map(([id, t]) => [id, t.tarifa]));
}

/** Id de una tarifa leída, o `null`. */
export function idTarifa(t: TarifaLeida | undefined): number | null {
  return t ? t[0] : null;
}

/** Nombre de una tarifa leída, o `null`. */
export function nombreTarifa(t: TarifaLeida | undefined): string | null {
  return t ? t[1] : null;
}
