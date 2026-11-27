import { createHmac, timingSafeEqual } from 'node:crypto';
import { SEDES, type DemoAplicacion } from '@asta/shared-types';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { searchRead } from '../odoo/client.js';
import { dePantalla } from './pantallas.js';
import { almacenesDeOdoo, type KioscoAutenticado } from './kioscos.service.js';

/**
 * La demostración de la aplicación ASTA para el vendedor (nov-2026): va a ver a
 * un cliente y le enseña la aplicación en su teléfono, sin activar una tablet.
 *
 * ── Un token firmado, no una tablet ──────────────────────────────────────────
 *
 * Una tablet de verdad es una fila en `kiosk_devices`; una demostración no:
 * llenaría la lista de Tablets de visitas. El token lleva quién la abrió, el
 * almacén y cuándo caduca, firmado con el HMAC del pepper de las API keys
 * (`asta_demo_<datos>.<firma>`). El middleware lo comprueba sin buscar nada,
 * salvo que la cuenta siga activa y sea del personal.
 *
 * ── Qué enseña ───────────────────────────────────────────────────────────────
 *
 * Lo mismo que una tablet de Supricom de su sede: el recomendador, con las
 * existencias del almacén principal de la compañía del vendedor en Odoo. Las
 * búsquedas quedan a nombre del vendedor (no de una tablet), así que no
 * cuentan en las cifras por sede de las tablets.
 *
 * Caduca al terminar el día en Caracas: es para una jornada de visitas.
 */

export const PREFIJO_DEMO = 'asta_demo_';
const FORMA = /^asta_demo_([A-Za-z0-9_-]{10,400})\.([A-Za-z0-9_-]{43})$/;

/** Venezuela, UTC−4 todo el año. */
const DESFASE_CARACAS_MS = -4 * 3600_000;

/** La medianoche siguiente en Caracas: el final de la jornada. */
export function finDelDia(ahora: Date): Date {
  const dia = Math.floor((ahora.getTime() + DESFASE_CARACAS_MS) / 86_400_000);
  return new Date((dia + 1) * 86_400_000 - DESFASE_CARACAS_MS);
}

interface Datos {
  /** app_users.id de quien la abrió. */
  u: string;
  /** Compañía y almacén de Odoo; null si no tiene sede (solo compatibilidades). */
  c: number | null;
  w: number | null;
  /** Caducidad, en ms. */
  e: number;
}

function firmar(pepper: string, datos: string): string {
  return createHmac('sha256', pepper).update(`demo:${datos}`).digest('base64url');
}

function iguales(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** El almacén principal de la sede del vendedor, o null si no tiene (o Odoo no responde). */
async function almacenDe(odooUserId: number | null): Promise<{ companyId: number; warehouseId: number } | null> {
  if (odooUserId === null) return null;
  try {
    // Las mismas claves que «Tu puesto» y la lista de tablets: se comparte lo guardado.
    const [usuario] = await dePantalla(`vendedor:${odooUserId}:compania`, () =>
      searchRead<{ id: number; company_id: [number, string] | false }>('res.users', [['id', '=', odooUserId]], ['company_id'], { context: { active_test: false } }),
    );
    const compania = usuario?.company_id ? usuario.company_id[0] : null;
    if (compania === null) return null;
    const almacenes = (await dePantalla('admin:almacenes', almacenesDeOdoo)).filter((a) => a.companyId === compania);
    const a = almacenes.find((x) => x.principal) ?? almacenes[0];
    return a ? { companyId: a.companyId, warehouseId: a.warehouseId } : null;
  } catch {
    return null;
  }
}

/** Abre una demostración para quien la pide: el token, cuándo caduca y de qué sede son las existencias. */
export async function abrirDemo(appUserId: string, odooUserId: number | null, ahora = new Date()): Promise<DemoAplicacion> {
  const almacen = await almacenDe(odooUserId);
  const caduca = finDelDia(ahora);
  const datos: Datos = { u: appUserId, c: almacen?.companyId ?? null, w: almacen?.warehouseId ?? null, e: caduca.getTime() };
  const cuerpo = Buffer.from(JSON.stringify(datos)).toString('base64url');
  return {
    token: `${PREFIJO_DEMO}${cuerpo}.${firmar(env().API_KEY_PEPPER, cuerpo)}`,
    caduca: caduca.toISOString(),
    sede: almacen ? (SEDES.find((s) => s.id === almacen.companyId)?.nombre ?? null) : null,
  };
}

/** Cuentas ya comprobadas, un minuto: el token se usa en cada búsqueda. */
const cuentas = new Map<string, { vale: boolean; hasta: number }>();

/** Solo para tests. */
export function olvidarCuentasDemo(): void {
  cuentas.clear();
}

async function cuentaVale(appUserId: string, ahora: number): Promise<boolean> {
  const c = cuentas.get(appUserId);
  if (c && c.hasta > ahora) return c.vale;
  const u = await prisma.appUser.findUnique({ where: { id: appUserId }, select: { isActive: true, role: true } });
  const vale = !!u && u.isActive && (u.role === 'VENDEDOR' || u.role === 'SUPERADMIN');
  cuentas.set(appUserId, { vale, hasta: ahora + 60_000 });
  return vale;
}

/**
 * La demostración de este token, o null: mal formado, firma que no cuadra,
 * caducado, o la cuenta ya no está activa o no es del personal. Como con los
 * tokens de tablet, no se dice por qué.
 */
export async function verificarTokenDemo(token: string, ahora = new Date()): Promise<KioscoAutenticado | null> {
  const m = FORMA.exec(token);
  if (!m) return null;
  const [, cuerpo, firma] = m as unknown as [string, string, string];
  const peppers = [env().API_KEY_PEPPER, env().API_KEY_PEPPER_ANTERIOR].filter((p): p is string => !!p);
  if (!peppers.some((p) => iguales(firmar(p, cuerpo), firma))) return null;

  let datos: Datos;
  try {
    datos = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8')) as Datos;
  } catch {
    return null;
  }
  if (typeof datos.u !== 'string' || typeof datos.e !== 'number' || datos.e <= ahora.getTime()) return null;
  if (!(await cuentaVale(datos.u, ahora.getTime()))) return null;

  return {
    deviceId: `demo:${datos.u}`,
    almacen: datos.c !== null && datos.w !== null ? { companyId: datos.c, warehouseId: datos.w } : null,
    demo: { appUserId: datos.u },
  };
}
