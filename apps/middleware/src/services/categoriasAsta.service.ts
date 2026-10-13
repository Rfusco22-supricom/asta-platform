import {
  CATEGORIAS_ASTA,
  META_MENSUAL_ASTA,
  MESES_VENTANA_CATEGORIA,
  categoriaDe,
  limpiarEspacios,
  nombrePersona,
  type CategoriasAsta,
  type ClienteCategoria,
} from '@asta/shared-types';
import { readGroup, searchRead } from '../odoo/client.js';
import { normalizarRif, rifUtilizable } from './duplicados.js';
import { LINEAS_ASTA } from './ventasAsta.service.js';

/**
 * La categoría de ASTA de cada cliente (reglas en `@asta/shared-types`,
 * `categoriasAsta.ts`).
 *
 * ── La ventana ───────────────────────────────────────────────────────────────
 *
 * Los cuatro últimos meses COMPLETOS: el 13 de octubre son junio a septiembre.
 * El mes en curso no entra, porque a mitad de mes todo el mundo parece comprar
 * la mitad. Un `read_group` por mes, en paralelo, y no uno agrupado por
 * `invoice_date:month`: Odoo devuelve ese grupo con el nombre del mes en el
 * idioma del usuario («septiembre 2026»), y aquí hace falta la fecha.
 *
 * ── Por RIF ──────────────────────────────────────────────────────────────────
 *
 * Como en la propuesta: un cliente con dos fichas (#50) es un cliente. Sin RIF
 * utilizable, cuenta su ficha comercial sola. El nombre, el vendedor y el enlace
 * son los de la ficha que más compró.
 *
 * Las mismas líneas que el resto del panel de ASTA (`LINEAS_ASTA`): sin IVA,
 * netas de notas de crédito y sin las ventas entre empresas del grupo.
 * Comprobado el 2026-10-13 contra el análisis de Marketing de junio a
 * septiembre: 53.071 USD/mes frente a sus 53.055,65.
 */

interface Grupo {
  partner_id: [number, string] | false;
  balance: number;
}

interface FichaPartner {
  id: number;
  name: string | false;
  vat: string | false;
  user_id: [number, string] | false;
}

/** Los `n` meses completos anteriores a `hoy`, del más antiguo al más reciente, como «YYYY-MM». */
export function mesesDeLaVentana(hoy: Date, n = MESES_VENTANA_CATEGORIA): string[] {
  const meses: string[] = [];
  for (let i = n; i >= 1; i--) {
    const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - i, 1));
    meses.push(d.toISOString().slice(0, 7));
  }
  return meses;
}

function finDeMes(mes: string): string {
  const [a, m] = mes.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}

/** Lo que le falta para la categoría inmediatamente superior. */
export function siguienteCategoria(compraMensual: number, meses: number): ClienteCategoria['siguiente'] {
  const actual = categoriaDe(compraMensual, meses);
  const i = CATEGORIAS_ASTA.indexOf(actual);
  if (i <= 0) return null;
  const arriba = CATEGORIAS_ASTA[i - 1]!;
  return {
    categoria: arriba.clave,
    faltaMensual: Math.max(0, Math.round((arriba.minimoMensual - compraMensual) * 100) / 100),
    faltanMeses: Math.max(0, arriba.minimoMeses - meses),
  };
}

const redondear = (x: number) => Math.round(x * 100) / 100;

export async function categoriasAsta(opciones: { hoy?: Date } = {}): Promise<CategoriasAsta> {
  const meses = mesesDeLaVentana(opciones.hoy ?? new Date());

  const porMes = await Promise.all(
    meses.map((mes) =>
      readGroup<Grupo>(
        'account.move.line',
        [...LINEAS_ASTA, ['invoice_date', '>=', `${mes}-01`], ['invoice_date', '<=', finDeMes(mes)]],
        ['balance:sum'],
        ['partner_id'],
      ),
    ),
  );

  const ids = [...new Set(porMes.flat().flatMap((g) => (g.partner_id ? [g.partner_id[0]] : [])))];
  const fichas = ids.length
    ? await searchRead<FichaPartner>('res.partner', [['id', 'in', ids]], ['name', 'vat', 'user_id'], { context: { active_test: false } })
    : [];
  const ficha = new Map(fichas.map((f) => [f.id, f]));

  const claveDe = (id: number) => {
    const rif = normalizarRif(ficha.get(id)?.vat || null);
    return rifUtilizable(rif) ? rif! : `p${id}`;
  };

  // Por cliente (RIF): lo comprado cada mes, y cuánto compró cada ficha.
  const grupos = new Map<string, { porMes: number[]; porFicha: Map<number, number> }>();
  porMes.forEach((lista, i) => {
    for (const g of lista) {
      if (!g.partner_id) continue;
      const id = g.partner_id[0];
      const k = claveDe(id);
      const grupo = grupos.get(k) ?? { porMes: meses.map(() => 0), porFicha: new Map<number, number>() };
      grupo.porMes[i]! += -g.balance;
      grupo.porFicha.set(id, (grupo.porFicha.get(id) ?? 0) - g.balance);
      grupos.set(k, grupo);
    }
  });

  const clientes: ClienteCategoria[] = [];
  for (const [clave, g] of grupos) {
    const total = g.porMes.reduce((s, x) => s + x, 0);
    if (total <= 0) continue;
    const compraMensual = total / meses.length;
    const mesesConCompra = g.porMes.filter((x) => x > 0).length;
    const principal = [...g.porFicha.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    const f = ficha.get(principal);
    clientes.push({
      clave,
      partnerId: principal,
      nombre: limpiarEspacios(f?.name || `Cliente #${principal}`),
      rif: f?.vat ? String(f.vat).trim() : null,
      vendedor: f?.user_id ? nombrePersona(f.user_id[1]) : null,
      vendedorOdooUserId: f?.user_id ? f.user_id[0] : null,
      porMes: g.porMes.map(redondear),
      compraMensual: redondear(compraMensual),
      mesesConCompra,
      categoria: categoriaDe(compraMensual, mesesConCompra).clave,
      siguiente: siguienteCategoria(compraMensual, mesesConCompra),
    });
  }

  clientes.sort((a, b) => b.compraMensual - a.compraMensual);

  return {
    meses,
    compraMensual: redondear(clientes.reduce((s, c) => s + c.compraMensual, 0)),
    meta: META_MENSUAL_ASTA,
    porCategoria: CATEGORIAS_ASTA.map((c) => {
      const de = clientes.filter((x) => x.categoria === c.clave);
      return {
        categoria: c.clave,
        clientes: de.length,
        compraMensual: redondear(de.reduce((s, x) => s + x.compraMensual, 0)),
        metaClientes: c.metaClientes,
        metaCompraMensual: c.metaCompraMensual,
      };
    }),
    clientes,
  };
}
