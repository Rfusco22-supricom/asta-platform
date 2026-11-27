import { catalogoAstaSchema, type CatalogoAsta } from '@asta/shared-types';
import { searchRead } from '../../odoo/client.js';
import { dePantalla } from '../pantallas.js';
import { preciosDe, validarTarifa } from '../pricing.service.js';
import datos from './catalogoAsta.json';

/**
 * El catálogo ASTA de la sección «Catálogo» del personal.
 *
 * `catalogoAsta.json` no se escribe a mano: sale de la misma generación que el
 * PDF del catálogo (fotos de Odoo, agrupado por series y colores), junto con
 * las fotos de `apps/web/public/catalogo/` y el PDF base de
 * `apps/web/privado/catalogo/`. Al actualizar el catálogo se regeneran a la vez.
 *
 * ── Los precios, de Odoo y no del repositorio ────────────────────────────────
 *
 * El repositorio es público: una tarifa escrita en un JSON o dentro de un PDF
 * la vería cualquiera. Por eso las fichas van sin precio y aquí se le pone el
 * de hoy de la «Lista de Precios» de Valencia (la que eligió la gerencia para
 * el catálogo), con la misma lectura que la API de precios (`preciosDe`). El
 * PDF con precios se arma en el panel con estos mismos, así que la página y el
 * PDF no pueden discrepar.
 *
 * Se valida al cargar: un JSON regenerado con otra forma falla aquí, en el
 * arranque, y no en la pantalla de un vendedor.
 */

const FICHAS = catalogoAstaSchema.parse(datos);

/** «Lista de Precios» de Office Solutions (Valencia), en USD. */
export const TARIFA_CATALOGO = 15866;

async function conPrecios(): Promise<CatalogoAsta> {
  const [tarifa] = await searchRead<{ id: number; company_id: [number, string] | false }>(
    'product.pricelist',
    [['id', '=', TARIFA_CATALOGO]],
    ['company_id'],
  );
  const valida = tarifa?.company_id ? await validarTarifa(TARIFA_CATALOGO, tarifa.company_id[0]) : null;
  if (!valida?.ok) return FICHAS;

  const skus = [...new Set(FICHAS.fichas.flatMap((f) => f.variantes.map((v) => v.codigo)).filter(Boolean))];
  const { precios } = await preciosDe(valida.tarifa, skus);
  const precio = new Map(precios.map((p) => [p.sku, p.precio]));
  return {
    ...FICHAS,
    preciosLeidos: new Date().toISOString(),
    fichas: FICHAS.fichas.map((f) => ({ ...f, variantes: f.variantes.map((v) => ({ ...v, precio: precio.get(v.codigo) ?? null })) })),
  };
}

/** Las fichas con el precio de hoy. Iguales para todo el personal: una sola clave. */
export function catalogoAsta(): Promise<CatalogoAsta> {
  return dePantalla('catalogo:precios', conPrecios);
}
