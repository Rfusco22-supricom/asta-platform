import { searchRead, readGroup } from '../odoo/client.js';
import { normalizarNombre, normalizarRif, rifUtilizable } from './duplicados.js';

/**
 * Otros registros de Odoo que son el MISMO cliente (issue #50).
 *
 * ── Por qué el panel tiene que avisar ────────────────────────────────────────
 *
 * El 34,5 % de lo facturado —10,9 M— está repartido entre registros duplicados
 * del mismo cliente. «SUPER TECHNO LLC» tiene 2.519.837 en un registro y 5.632
 * en otro; «GALLERY COMPUTER, PZO» está partido entre dos vendedores distintos.
 *
 * Los totales que calcula `invoicing.service.ts` son exactos —verificados al
 * centavo— y aun así el número que ve el vendedor **es falso como retrato del
 * cliente**, porque la entidad «cliente» en Odoo no es una sola fila.
 *
 * Arreglarlo es fusionar en Odoo, y eso lo decide una persona: 113 de los 139
 * grupos partidos cruzan carteras, así que fusionar mueve facturación y comisión
 * de un vendedor a otro. Mientras esa conversación no ocurra, lo único honesto
 * es que la ficha diga «esto no es todo».
 *
 * ── Lo que enseña, y la decisión que hay detrás ──────────────────────────────
 *
 * A un vendedor se le dice que existe otro registro, cuánto hay en él y de quién
 * es la cartera. Eso cruza la línea que #25 defiende —no ver clientes ajenos— y
 * es deliberado: no es el cliente de otro, es EL MISMO cliente partido en dos, y
 * sin el nombre del compañero el aviso no sirve para nada («habla con Arturo» es
 * accionable; «hay otro registro en algún sitio» no).
 *
 * Se enseña el TOTAL del otro registro, nunca sus facturas una a una. Si se
 * quiere apretar más, lo que se quita es el nombre del vendedor, no la cifra.
 */

export interface Hermano {
  partnerId: number;
  nombre: string;
  /** Por qué se considera el mismo cliente. */
  motivo: 'rif' | 'nombre';
  facturado: number;
  facturas: number;
  vendedorNombre: string | null;
}

export interface Hermanos {
  /** Lo facturado en el registro que se está mirando. */
  esteRegistro: number;
  /** Lo facturado sumando este registro y sus hermanos. */
  total: number;
  hermanos: Hermano[];
}

interface FilaPartner {
  id: number;
  name: string;
  vat: string | false;
  user_id: [number, string] | false;
}

/**
 * Busca hermanos por RIF y, si no hay RIF utilizable, por nombre normalizado.
 *
 * El orden importa y es el mismo de `agrupar()`: el RIF identifica, el nombre
 * solo se parece. Buscar por nombre cuando hay RIF juntaría «INVERSIONES 2020,
 * C.A.» con otra empresa distinta del mismo nombre, que las hay.
 */
export async function hermanosDe(partnerId: number): Promise<Hermanos> {
  const [yo] = await searchRead<FilaPartner>(
    'res.partner',
    [['id', '=', partnerId]],
    ['id', 'name', 'vat', 'user_id'],
  );
  if (!yo) return { esteRegistro: 0, total: 0, hermanos: [] };

  const rif = normalizarRif(yo.vat || null);

  let candidatos: FilaPartner[] = [];

  if (rifUtilizable(rif)) {
    candidatos = await searchRead<FilaPartner>(
      'res.partner',
      [
        ['vat', '!=', false],
        ['id', '!=', partnerId],
        ['active', '=', true],
        ['parent_id', '=', false],
      ],
      ['id', 'name', 'vat', 'user_id'],
    );
    candidatos = candidatos.filter((c) => normalizarRif(c.vat || null) === rif);
  } else {
    /*
     * Sin RIF utilizable se cae al nombre, y se filtra en Node.
     *
     * Odoo no puede comparar por el nombre NORMALIZADO —sin acentos, sin dobles
     * espacios—, así que un `ilike` traería casi aciertos y se dejaría los que
     * solo difieren en un acento, que son la mitad de los casos reales.
     */
    const nombre = normalizarNombre(yo.name);
    if (!nombre) return { esteRegistro: 0, total: 0, hermanos: [] };

    candidatos = await searchRead<FilaPartner>(
      'res.partner',
      [
        ['name', 'ilike', yo.name.slice(0, 12)],
        ['id', '!=', partnerId],
        ['active', '=', true],
        ['parent_id', '=', false],
      ],
      ['id', 'name', 'vat', 'user_id'],
    );
    candidatos = candidatos.filter((c) => normalizarNombre(c.name) === nombre);
  }

  const motivo: 'rif' | 'nombre' = rifUtilizable(rif) ? 'rif' : 'nombre';
  const ids = [partnerId, ...candidatos.map((c) => c.id)];

  const grupos = await readGroup<{
    commercial_partner_id: [number, string] | false;
    amount_total_signed: number;
    __count: number;
  }>(
    'account.move',
    [
      ['move_type', '=', 'out_invoice'],
      ['state', '=', 'posted'],
      ['commercial_partner_id', 'in', ids],
    ],
    ['amount_total_signed:sum'],
    ['commercial_partner_id'],
  );

  const facturacion = new Map<number, { monto: number; facturas: number }>();
  for (const g of grupos) {
    if (!g.commercial_partner_id) continue;
    facturacion.set(g.commercial_partner_id[0], {
      monto: g.amount_total_signed ?? 0,
      facturas: g.__count,
    });
  }

  const esteRegistro = Math.round((facturacion.get(partnerId)?.monto ?? 0) * 100) / 100;

  const hermanos: Hermano[] = candidatos
    .map((c) => {
      const f = facturacion.get(c.id);
      return {
        partnerId: c.id,
        nombre: c.name.trim(),
        motivo,
        facturado: Math.round((f?.monto ?? 0) * 100) / 100,
        facturas: f?.facturas ?? 0,
        vendedorNombre: c.user_id ? c.user_id[1] : null,
      };
    })
    /*
     * Solo los que tienen facturación.
     *
     * De los 272 grupos duplicados, 19 no tienen una sola factura y 114 la
     * tienen toda en un registro: avisar de esos sería ruido en la ficha de
     * media cartera. El aviso solo aparece cuando el número que se está mirando
     * está de verdad incompleto.
     */
    .filter((h) => h.facturado !== 0 || h.facturas > 0)
    .sort((a, b) => b.facturado - a.facturado);

  return {
    esteRegistro,
    total: Math.round((esteRegistro + hermanos.reduce((s, h) => s + h.facturado, 0)) * 100) / 100,
    hermanos,
  };
}
