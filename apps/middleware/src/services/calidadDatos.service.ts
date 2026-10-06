import type { CalidadDatos, ClaveRevision, Gravedad, Hallazgo, Revision } from '@asta/shared-types';
import { readGroup, searchRead } from '../odoo/client.js';
import { esEmailPlausible } from '../auth/email.js';
import { CacheTtl } from '../utils/cacheTtl.js';
import { nombrePartner } from '../utils/nombrePartner.js';
import { TIPO_FACTURADO, plegarPorTipo } from './criterioFacturacion.js';
import { problemaRif, problemasNombreVendedor, tieneEspaciosDeMas } from './calidadDatos.js';

/**
 * Calidad de los datos que llegan de Odoo.
 *
 * ── Por qué una pantalla y no un aviso en cada sitio ─────────────────────────
 *
 * El panel enseña lo que hay en Odoo, y lo que hay está mal en sitios concretos
 * que nadie ve porque no rompen nada a la vista: medido el 6-oct-2026, 52
 * clientes con compras en el año no tienen vendedor —no salen en ninguna
 * cartera—, 57 son de vendedores archivados y 48 facturas no tienen vendedor
 * —no cuentan en ningún reporte—.
 *
 * El panel no los arregla: escribir en Odoo no es su papel, y cada uno de estos
 * es una decisión (a quién se le asigna el cliente). Lo que hace es ponerlos
 * delante de quien decide, de más dinero a menos, con el sitio exacto donde se
 * corrige. La lista se lee de Odoo cada vez, así que encoge sola.
 *
 * ── Solo los clientes con compras en 12 meses ────────────────────────────────
 *
 * De los ~3.000 clientes activos, unos 750 no han comprado en un año. Un RIF mal
 * o un vendedor archivado en uno de esos no mueve ninguna cifra del panel, y
 * listarlos esconde los que sí.
 */

const cache = new CacheTtl<CalidadDatos & { generadoEn: string; duracionMs: number }>(10 * 60_000, 1);

/** Cuántas filas de cada revisión van en la respuesta. */
const MUESTRA = 100;

/** Solo para tests. */
export function vaciarCacheCalidad(): void {
  cache.vaciar();
}

interface FilaPartner {
  id: number;
  name: string | false;
  vat: string | false;
  email: string | false;
  user_id: [number, string] | false;
  company_id: [number, string] | false;
}

interface FilaUsuario {
  id: number;
  name: string;
  active: boolean;
}

interface FilaFactura {
  id: number;
  name: string | false;
  invoice_date: string | false;
  amount_total_signed: number;
  commercial_partner_id: [number, string] | false;
  company_id: [number, string] | false;
}

const redondear = (n: number) => Math.round(n * 100) / 100;
const nombreDe = (m2o: [number, string] | false) => (m2o ? m2o[1] : null);

function haceUnAnio(): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

/** Compañías de Venezuela: solo en ellas el RIF tiene que ser venezolano. */
async function companiasDeVenezuela(): Promise<Set<number>> {
  const companias = await searchRead<{ id: number; country_id: [number, string] | false }>('res.company', [], ['id', 'country_id']);
  const paises = [...new Set(companias.flatMap((c) => (c.country_id ? [c.country_id[0]] : [])))];
  const codigos = paises.length ? await searchRead<{ id: number; code: string | false }>('res.country', [['id', 'in', paises]], ['id', 'code']) : [];
  const venezuela = new Set(codigos.filter((p) => p.code === 'VE').map((p) => p.id));
  return new Set(companias.filter((c) => c.country_id && venezuela.has(c.country_id[0])).map((c) => c.id));
}

function revision(
  clave: ClaveRevision,
  gravedad: Gravedad,
  textos: { titulo: string; porQue: string; comoArreglar: Revision['comoArreglar']; unidad: string },
  hallazgos: Hallazgo[],
): Revision {
  const orden = [...hallazgos].sort((a, b) => b.facturado - a.facturado || a.nombre.localeCompare(b.nombre));
  return {
    clave,
    gravedad,
    ...textos,
    total: hallazgos.length,
    facturado: redondear(hallazgos.reduce((s, h) => s + h.facturado, 0)),
    muestra: orden.slice(0, MUESTRA).map((h) => ({ ...h, facturado: redondear(h.facturado) })),
  };
}

export async function calidadDeDatos({ fresco = false } = {}): Promise<
  CalidadDatos & { generadoEn: string; duracionMs: number; desdeCache: boolean }
> {
  const enCache = fresco ? undefined : cache.get('todo');
  if (enCache) return { ...enCache, desdeCache: true };

  const t0 = Date.now();
  const desde = haceUnAnio();

  const [partners, grupos, facturasSinVendedor, venezolanas] = await Promise.all([
    searchRead<FilaPartner>(
      'res.partner',
      [
        ['customer_rank', '>', 0],
        ['parent_id', '=', false],
        ['active', '=', true],
      ],
      ['id', 'name', 'vat', 'email', 'user_id', 'company_id'],
    ),
    readGroup<{ commercial_partner_id: [number, string] | false; move_type: string | false; amount_total_signed: number; __count: number }>(
      'account.move',
      [TIPO_FACTURADO, ['state', '=', 'posted'], ['invoice_date', '>=', desde]],
      ['amount_total_signed:sum'],
      ['commercial_partner_id', 'move_type'],
    ),
    searchRead<FilaFactura>(
      'account.move',
      [
        ['move_type', '=', 'out_invoice'],
        ['state', '=', 'posted'],
        ['invoice_date', '>=', desde],
        ['invoice_user_id', '=', false],
      ],
      ['id', 'name', 'invoice_date', 'amount_total_signed', 'commercial_partner_id', 'company_id'],
      { limit: 1000, order: 'invoice_date desc' },
    ),
    companiasDeVenezuela(),
  ]);

  const facturado = new Map<number, number>();
  const conFacturas = new Set<number>();
  for (const [id, { sumas, facturas }] of plegarPorTipo(grupos, (g) => (g.commercial_partner_id ? g.commercial_partner_id[0] : null), ['amount_total_signed'])) {
    facturado.set(id, sumas.amount_total_signed);
    if (facturas > 0) conFacturas.add(id);
  }

  // Los que han comprado en el año: con alguna factura, no solo notas de crédito.
  const activos = partners.filter((p) => conFacturas.has(p.id));

  const idsVendedores = [...new Set(partners.flatMap((p) => (p.user_id ? [p.user_id[0]] : [])))];
  const usuarios = idsVendedores.length
    ? await searchRead<FilaUsuario>('res.users', [['id', 'in', idsVendedores], ['active', 'in', [true, false]]], ['id', 'name', 'active'])
    : [];
  const archivados = new Set(usuarios.filter((u) => !u.active).map((u) => u.id));

  const hallazgo = (p: FilaPartner, detalle: string): Hallazgo => ({
    id: p.id,
    nombre: nombrePartner(p).trim(),
    detalle,
    compania: nombreDe(p.company_id),
    vendedor: nombreDe(p.user_id),
    facturado: facturado.get(p.id) ?? 0,
  });

  const sinVendedor: Hallazgo[] = [];
  const conArchivado: Hallazgo[] = [];
  const rifMal: Hallazgo[] = [];
  const sinCorreo: Hallazgo[] = [];
  const espacios: Hallazgo[] = [];

  for (const p of activos) {
    if (!p.user_id) sinVendedor.push(hallazgo(p, 'Sin vendedor asignado'));
    else if (archivados.has(p.user_id[0])) conArchivado.push(hallazgo(p, `Asignado a ${p.user_id[1].trim()}, archivado en Odoo`));

    if (p.company_id && venezolanas.has(p.company_id[0])) {
      const problema = problemaRif(p.vat);
      if (problema) rifMal.push(hallazgo(p, problema));
    }

    if (!p.email || !String(p.email).trim()) sinCorreo.push(hallazgo(p, 'Sin correo'));
    else if (!esEmailPlausible(String(p.email))) sinCorreo.push(hallazgo(p, `«${String(p.email).trim().slice(0, 60)}» no es un correo válido`));

    if (p.name && tieneEspaciosDeMas(p.name)) espacios.push(hallazgo(p, `«${p.name.replace(/ /g, '·')}»`));
  }

  // Los vendedores que tienen cartera viva, con lo que factura esa cartera.
  const carteraDe = new Map<number, number>();
  for (const p of activos) if (p.user_id) carteraDe.set(p.user_id[0], (carteraDe.get(p.user_id[0]) ?? 0) + (facturado.get(p.id) ?? 0));
  const nombresVendedor: Hallazgo[] = usuarios
    .filter((u) => u.active && carteraDe.has(u.id))
    .flatMap((u) => {
      const problemas = problemasNombreVendedor(u.name);
      if (!problemas.length) return [];
      const detalle = problemas.join(', ');
      return [{ id: u.id, nombre: u.name, detalle: detalle[0]!.toUpperCase() + detalle.slice(1), compania: null, vendedor: null, facturado: carteraDe.get(u.id)! }];
    });

  const facturas: Hallazgo[] = facturasSinVendedor.map((f) => ({
    id: f.id,
    nombre: f.commercial_partner_id ? f.commercial_partner_id[1].trim() : 'Sin cliente',
    detalle: `${f.name || `Factura #${f.id}`}${f.invoice_date ? ` del ${f.invoice_date.split('-').reverse().join('/')}` : ''}`,
    compania: nombreDe(f.company_id),
    vendedor: null,
    facturado: f.amount_total_signed,
  }));

  const revisiones: Revision[] = [
    revision('SIN_VENDEDOR', 'alta', {
      titulo: 'Clientes sin vendedor',
      porQue: 'No salen en la cartera de nadie: ningún vendedor ve su facturación ni le hace seguimiento.',
      comoArreglar: { ruta: ['Contactos', 'el cliente', 'pestaña Ventas y compras', 'Vendedor'], nota: null },
      unidad: 'clientes',
    }, sinVendedor),
    revision('VENDEDOR_INACTIVO', 'alta', {
      titulo: 'Clientes de un vendedor archivado',
      porQue: 'Su vendedor ya no entra al panel, así que esta cartera no la atiende nadie.',
      comoArreglar: { ruta: ['Contactos', 'filtrar por el vendedor', 'seleccionar', 'Acción', 'Editar', 'Vendedor'], nota: 'Se pueden reasignar todos de una vez.' },
      unidad: 'clientes',
    }, conArchivado),
    revision('FACTURAS_SIN_VENDEDOR', 'alta', {
      titulo: 'Facturas sin vendedor',
      porQue: 'No cuentan en los reportes de ningún vendedor, aunque el cliente sí tenga uno.',
      comoArreglar: { ruta: ['Facturación', 'la factura', 'pestaña Otra información', 'Vendedor'], nota: null },
      unidad: 'facturas',
    }, facturas),
    revision('RIF_INVALIDO', 'media', {
      titulo: 'RIF que falta o está mal',
      porQue: 'La factura sale con un RIF que el SENIAT no reconoce, y los duplicados de ese cliente no se detectan.',
      comoArreglar: { ruta: ['Contactos', 'el cliente', 'campo RIF (NIF)'], nota: 'Solo se revisan las compañías de Venezuela.' },
      unidad: 'clientes',
    }, rifMal),
    revision('SIN_CORREO', 'media', {
      titulo: 'Clientes sin correo válido',
      porQue: 'Sin correo no se les puede crear la cuenta del panel ni mandarles la invitación.',
      comoArreglar: { ruta: ['Contactos', 'el cliente', 'Correo electrónico'], nota: 'En la siguiente sincronización se le crea la cuenta.' },
      unidad: 'clientes',
    }, sinCorreo),
    revision('NOMBRE_VENDEDOR', 'baja', {
      titulo: 'Nombres de vendedor mal escritos',
      porQue: 'El nombre sale en el panel, en los reportes y en las facturas. Hoy cada uno está escrito de una forma.',
      comoArreglar: { ruta: ['Ajustes', 'Usuarios', 'el vendedor', 'Nombre'], nota: 'Basta con «Nombre Apellido».' },
      unidad: 'vendedores',
    }, nombresVendedor),
    revision('ESPACIOS_EN_NOMBRE', 'baja', {
      titulo: 'Nombres de cliente con espacios de más',
      porQue: 'Se ven descuadrados y la búsqueda exacta por nombre no los encuentra. Los «·» marcan dónde están.',
      comoArreglar: { ruta: ['Contactos', 'el cliente', 'Nombre'], nota: 'Quitar los espacios dobles y los del principio o el final.' },
      unidad: 'clientes',
    }, espacios),
  ];

  const informe = { clientes: activos.length, revisiones, generadoEn: new Date().toISOString(), duracionMs: Date.now() - t0 };
  cache.set('todo', informe);
  return { ...informe, desdeCache: false };
}
