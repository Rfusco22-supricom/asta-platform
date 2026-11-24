import { SEDES, nombrePersona, type RankingSede } from '@asta/shared-types';
import { searchRead } from '../odoo/client.js';
import { dePantalla } from './pantallas.js';
import type { RangoFechas } from './reportes.service.js';
import { reporteAstaDeLaEmpresa } from './reporteAsta.service.js';

/**
 * El puesto de cada vendedor entre los de su sede, para su Inicio: el spiff de
 * ASTA quiere que cada uno sepa si va primero, segundo o tercero.
 *
 *   · Su sede es la compañía de su usuario de Odoo (Valencia u Caracas).
 *   · Compiten TODOS los vendedores de esa sede: los usuarios de Odoo de esa
 *     compañía que vendieron ASTA en los últimos doce meses y siguen activos
 *     en Odoo, más quien haya vendido en el mes aunque esté de baja. Tengan o
 *     no cuenta en el panel. Sin los puestos («Asistente de Ventas…»). El que
 *     mira, siempre.
 *   · Se ordenan por lo vendido de ASTA a su cartera en el periodo, con el
 *     mismo criterio que el ranking del administrador (`porVendedor`).
 *
 * NUNCA salen montos: la respuesta lleva puesto y nombre, nada más. Que un
 * vendedor vea la cifra de otro no es cosa de la pantalla, es de la API.
 */

interface Competidor {
  odooUserId: number;
  nombre: string;
  facturado: number;
}

/** Los doce meses que acaban en `hasta`: del día 1 del mes de hace once meses a `hasta`. */
function doceMesesHasta(hasta: string): RangoFechas {
  const [a, m] = hasta.split('-').map(Number) as [number, number];
  return { desde: new Date(Date.UTC(a, m - 12, 1)).toISOString().slice(0, 10), hasta };
}

const esPuesto = (nombre: string) => /^\s*asistente\b/i.test(nombre);

/** Los de una sede, de más a menos vendido. Se calcula una vez por sede y periodo. */
async function competidores(sede: number, rango: RangoFechas, incluir: number): Promise<Competidor[]> {
  const anio = doceMesesHasta(rango.hasta);
  // Las mismas claves que el reporte de la empresa del administrador: se comparte lo guardado.
  const [delMes, delAnio] = await Promise.all([
    dePantalla(`admin:reportes:todas:${rango.desde}:${rango.hasta}`, () => reporteAstaDeLaEmpresa(rango, null)),
    dePantalla(`admin:reportes:todas:${anio.desde}:${anio.hasta}`, () => reporteAstaDeLaEmpresa(anio, null)),
  ]);
  const vendido = new Map((delMes.porVendedor ?? []).flatMap((v) => (v.odooUserId ? [[v.odooUserId, v.facturado] as [number, number]] : [])));
  const vendieron = (delAnio.porVendedor ?? []).flatMap((v) => (v.odooUserId && v.facturado > 0 ? [v.odooUserId] : []));
  const ids = [...new Set([...vendieron, ...vendido.keys(), incluir])];
  const usuarios = await searchRead<{ id: number; name: string; active: boolean; company_id: [number, string] | false }>(
    'res.users',
    ['|', ['active', '=', true], ['active', '=', false], ['id', 'in', ids]],
    ['name', 'active', 'company_id'],
  );
  return usuarios
    .filter((u) => (u.company_id ? u.company_id[0] : null) === sede && !esPuesto(u.name))
    // De baja en Odoo solo si vendió en el mes: quien se fue no está en la lista.
    .filter((u) => u.id === incluir || u.active || (vendido.get(u.id) ?? 0) > 0)
    .map((u) => ({ odooUserId: u.id, nombre: nombrePersona(u.name), facturado: vendido.get(u.id) ?? 0 }))
    .sort((a, b) => b.facturado - a.facturado || a.nombre.localeCompare(b.nombre));
}

/** El puesto de `odooUserId` en su sede y la lista, sin montos. */
export async function rankingDeSede(odooUserId: number, rango: RangoFechas): Promise<RankingSede> {
  const [usuario] = await searchRead<{ id: number; company_id: [number, string] | false }>('res.users', [['id', '=', odooUserId]], ['company_id'], {
    context: { active_test: false },
  });
  const sede = SEDES.find((s) => s.id === (usuario?.company_id ? usuario.company_id[0] : null));
  if (!sede) return { sede: null, periodo: rango, posicion: null, total: 0, filas: [] };

  const lista = await dePantalla(`vendedor:ranking:${sede.id}:${rango.desde}:${rango.hasta}:${odooUserId}`, () => competidores(sede.id, rango, odooUserId));
  // Puesto con empates: 1, 2, 2, 4. Dos con lo mismo vendido comparten puesto.
  const filas = lista.map((c, i) => ({
    posicion: lista.findIndex((o) => o.facturado === c.facturado) + 1 || i + 1,
    nombre: c.nombre,
    tuyo: c.odooUserId === odooUserId,
    sinVentas: c.facturado <= 0,
  }));
  return { sede: sede.nombre, periodo: rango, posicion: filas.find((f) => f.tuyo)?.posicion ?? null, total: filas.length, filas };
}
