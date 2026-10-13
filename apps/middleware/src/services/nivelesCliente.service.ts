import { clientTierSchema, type ClaveCategoria, type ClientTier } from '@asta/shared-types';
import { prisma } from '../config/prisma.js';
import { searchRead } from '../odoo/client.js';
import { normalizarRif, rifUtilizable } from './duplicados.js';
import { categoriasAsta } from './categoriasAsta.service.js';

/**
 * El nivel de cada cuenta de cliente es su categoría de ASTA (#131).
 *
 * Hasta el 2026-10-13 el nivel salía de la tarifa de Odoo (`tier_pricelist_map`),
 * y como nadie decidió qué tarifa era qué nivel, todos eran Bronce. Desde aquí lo
 * decide lo que el cliente compra de ASTA (`categoriasAsta.service`).
 *
 * ── Una pasada aparte, una vez al día ────────────────────────────────────────
 *
 * No puede hacerlo el sync de clientes: solo relee los que cambiaron en Odoo, y
 * la categoría cambia porque cambian las facturas, no la ficha. Esta pasada lee
 * TODAS las cuentas de cliente, su RIF en Odoo, y les pone el nivel de su grupo.
 * La ventana son meses completos, así que de verdad solo cambia al empezar el
 * mes; pasar a diario cubre las cuentas nuevas, que nacen en GENERAL.
 *
 * Solo cambia el nivel. No toca precios (la API sirve la tarifa real de Odoo)
 * ni permisos (todos los niveles son clientes con los mismos permisos).
 */

/** Categoría → nivel. ORO es GOLD: el valor técnico se quedó en inglés. */
export const NIVEL_DE_CATEGORIA: Record<ClaveCategoria, ClientTier> = {
  DIAMANTE: 'DIAMANTE',
  ORO: 'GOLD',
  PLATA: 'PLATA',
  BRONCE: 'BRONCE',
  GENERAL: 'GENERAL',
};

/** La clave de agrupación de una ficha: su RIF, o «p<comercial>» sin RIF utilizable. Igual que en `categoriasAsta`. */
export function claveDeFicha(vat: string | false | null, comercialId: number): string {
  const rif = normalizarRif(vat || null);
  return rifUtilizable(rif) ? rif! : `p${comercialId}`;
}

export interface ResumenNiveles {
  cuentas: number;
  porNivel: Record<ClientTier, number>;
  cambios: number;
  /** «BRONCE → GOLD: 3», para el registro y el simulacro. */
  movimientos: Record<string, number>;
}

interface Ficha {
  id: number;
  vat: string | false;
  commercial_partner_id: [number, string] | false;
}

export async function aplicarNiveles(opciones: { aplicar: boolean; hoy?: Date }): Promise<ResumenNiveles> {
  const categorias = await categoriasAsta({ hoy: opciones.hoy });
  const categoriaDeClave = new Map(categorias.clientes.map((c) => [c.clave, c.categoria]));

  const cuentas = await prisma.appUser.findMany({
    where: { role: { in: clientTierSchema.options } },
    select: { id: true, odooPartnerId: true, role: true },
  });

  // El RIF de cada cuenta, en lotes: unas 2.300 fichas.
  const fichas = new Map<number, Ficha>();
  const ids = cuentas.map((c) => c.odooPartnerId);
  for (let i = 0; i < ids.length; i += 1000) {
    const lote = await searchRead<Ficha>('res.partner', [['id', 'in', ids.slice(i, i + 1000)]], ['vat', 'commercial_partner_id'], {
      context: { active_test: false },
    });
    for (const f of lote) fichas.set(f.id, f);
  }

  const porNivel = Object.fromEntries(clientTierSchema.options.map((t) => [t, 0])) as Record<ClientTier, number>;
  const movimientos: Record<string, number> = {};
  const aCambiar = new Map<ClientTier, string[]>();

  for (const c of cuentas) {
    const f = fichas.get(c.odooPartnerId);
    const comercial = f?.commercial_partner_id ? f.commercial_partner_id[0] : c.odooPartnerId;
    const categoria = categoriaDeClave.get(claveDeFicha(f?.vat ?? null, comercial)) ?? 'GENERAL';
    const nivel = NIVEL_DE_CATEGORIA[categoria];
    porNivel[nivel]++;
    if (nivel !== c.role) {
      const clave = `${c.role} → ${nivel}`;
      movimientos[clave] = (movimientos[clave] ?? 0) + 1;
      aCambiar.set(nivel, [...(aCambiar.get(nivel) ?? []), c.id]);
    }
  }

  if (opciones.aplicar) {
    for (const [nivel, idsCuenta] of aCambiar) {
      // Por lotes y solo cuentas de cliente: el filtro de rol repetido aquí es
      // la garantía de que nunca se degrada a un vendedor o a un administrador.
      for (let i = 0; i < idsCuenta.length; i += 500) {
        await prisma.appUser.updateMany({
          where: { id: { in: idsCuenta.slice(i, i + 500) }, role: { in: clientTierSchema.options } },
          data: { role: nivel },
        });
      }
    }
  }

  return { cuentas: cuentas.length, porNivel, cambios: [...aCambiar.values()].reduce((s, x) => s + x.length, 0), movimientos };
}
