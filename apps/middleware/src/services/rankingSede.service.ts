import { SEDES, nombrePersona, type RankingSede } from '@asta/shared-types';
import { prisma } from '../config/prisma.js';
import { searchRead } from '../odoo/client.js';
import { dePantalla } from './pantallas.js';
import type { RangoFechas } from './reportes.service.js';
import { reporteAstaDeLaEmpresa } from './reporteAsta.service.js';

/**
 * El puesto de cada vendedor entre los de su sede, para su Inicio: el spiff de
 * ASTA quiere que cada uno sepa si va primero, segundo o tercero.
 *
 *   · Su sede es la compañía de su usuario de Odoo (Valencia u Caracas).
 *   · Compiten los de esa sede con cuenta de VENDEDOR activa en el panel, y los
 *     administradores que venden (con ventas de su cartera en el periodo): un
 *     administrador sin cartera no es un rival. Sin los puestos («Asistente de
 *     Ventas…»). El que mira, siempre.
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

/** Los de una sede, de más a menos vendido. Se calcula una vez por sede y periodo. */
async function competidores(sede: number, rango: RangoFechas, incluir: number): Promise<Competidor[]> {
  const cuentas = await prisma.appUser.findMany({
    where: { role: { in: ['VENDEDOR', 'SUPERADMIN'] }, isActive: true, odooUserId: { not: null } },
    select: { odooUserId: true, fullName: true, role: true },
  });
  const esVendedor = new Set(cuentas.filter((c) => c.role === 'VENDEDOR').map((c) => c.odooUserId!));
  const ids = [...new Set([...cuentas.filter((c) => !/^\s*asistente\b/i.test(c.fullName)).map((c) => c.odooUserId!), incluir])];
  const [usuarios, reporte] = await Promise.all([
    searchRead<{ id: number; name: string; company_id: [number, string] | false }>('res.users', [['id', 'in', ids]], ['name', 'company_id'], {
      context: { active_test: false },
    }),
    // La misma clave que el reporte de la empresa del administrador: se comparte lo guardado.
    dePantalla(`admin:reportes:todas:${rango.desde}:${rango.hasta}`, () => reporteAstaDeLaEmpresa(rango, null)),
  ]);
  const vendido = new Map((reporte.porVendedor ?? []).flatMap((v) => (v.odooUserId ? [[v.odooUserId, v.facturado] as [number, number]] : [])));
  return usuarios
    .filter((u) => (u.company_id ? u.company_id[0] : null) === sede && !/^\s*asistente\b/i.test(u.name))
    // Un administrador compite solo si vende (tiene ventas de su cartera en el periodo).
    .filter((u) => u.id === incluir || esVendedor.has(u.id) || (vendido.get(u.id) ?? 0) > 0)
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
