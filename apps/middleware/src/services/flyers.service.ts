import type { DatosFlyer } from '@asta/shared-types';
import { readGroup, searchRead, type OdooDomain } from '../odoo/client.js';
import { CacheTtl } from '../utils/cacheTtl.js';
import { MARCA_ASTA } from './asta.service.js';
import { TIPO_FACTURADO_LINEA } from './criterioFacturacion.js';
import { LINEA_ASTA } from './ventasAsta.service.js';

/**
 * «Mis flyers» (ver `flyers.ts` en shared-types): los datos de la tienda del
 * cliente y los productos ASTA con foto. La imagen la dibuja su navegador.
 *
 * Las fotos salen de Odoo (`image_1024` de la plantilla) y solo de productos
 * ASTA a la venta: la ruta no sirve la foto de cualquier producto por su id.
 */

/**
 * Las mismas condiciones para la lista y para la foto. Además de la marca, el
 * nombre lleva la palabra «ASTA» (`esNombreAsta`): en Odoo hay originales con
 * la marca ASTA puesta por error (tóneres Canon «LASERJET ORIGINAL», botellas
 * «ORIGINAL CANON»), y un flyer de ASTA no puede anunciar otra marca (decidido
 * con Supricom el 2026-11-10).
 */
export const esNombreAsta = (nombre: string) => /\bASTA\b/i.test(nombre);

const ASTA_CON_FOTO: OdooDomain = [
  ['spiff_brand_id', '=', MARCA_ASTA],
  ['sale_ok', '=', true],
  ['image_1920', '!=', false],
];

/** Meses de compras con los que se marca «lo compra». */
const MESES_LO_COMPRA = 6;

const cacheProductos = new CacheTtl<Array<{ templateId: number; sku: string | null; nombre: string }>>(3600_000, 1);
const cacheFotos = new CacheTtl<Buffer | null>(6 * 3600_000, 300);

async function productosConFoto() {
  const enCache = cacheProductos.get('asta');
  if (enCache) return enCache;
  const filas = await searchRead<{ id: number; name: string; default_code: string | false }>('product.template', ASTA_CON_FOTO, ['name', 'default_code'], { order: 'name' });
  const r = filas.filter((f) => esNombreAsta(f.name)).map((f) => ({ templateId: f.id, sku: f.default_code || null, nombre: f.name }));
  cacheProductos.set('asta', r);
  return r;
}

/** Las plantillas ASTA que el cliente (o sus contactos) ha comprado en `MESES_LO_COMPRA` meses. */
async function plantillasQueCompra(partnerId: number, hoy: Date): Promise<Set<number>> {
  const desde = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - MESES_LO_COMPRA + 1, 1)).toISOString().slice(0, 10);
  const grupos = await readGroup<{ product_id: [number, string] | false }>(
    'account.move.line',
    [['parent_state', '=', 'posted'], TIPO_FACTURADO_LINEA, ['display_type', '=', 'product'], LINEA_ASTA, ['partner_id', 'child_of', partnerId], ['invoice_date', '>=', desde]],
    ['quantity:sum'],
    ['product_id'],
  );
  const productos = grupos.map((g) => (g.product_id ? g.product_id[0] : null)).filter((x): x is number => x !== null);
  if (productos.length === 0) return new Set();
  const filas = await searchRead<{ product_tmpl_id: [number, string] }>('product.product', [['id', 'in', productos]], ['product_tmpl_id'], { context: { active_test: false } });
  return new Set(filas.map((f) => f.product_tmpl_id[0]));
}

export async function datosFlyer(partnerId: number, hoy = new Date()): Promise<DatosFlyer> {
  type Ficha = { name: string; phone: string | false; mobile: string | false; street: string | false; city: string | false; state_id: [number, string] | false };
  const [[ficha], productos, compra] = await Promise.all([
    searchRead<Ficha>('res.partner', [['id', '=', partnerId]], ['name', 'phone', 'mobile', 'street', 'city', 'state_id'], { context: { active_test: false } }),
    productosConFoto(),
    plantillasQueCompra(partnerId, hoy).catch(() => new Set<number>()),
  ]);
  // «Distrito Capital (VE)» → «Distrito Capital»: el país sobra en un flyer local.
  const estado = ficha?.state_id ? ficha.state_id[1].replace(/\s*\([A-Z]{2}\)$/, '') : null;
  const lugar = [ficha?.city || null, estado].filter((x, i, a): x is string => Boolean(x) && a.indexOf(x) === i).join(', ');
  const direccion = [ficha?.street || null, lugar || null].filter(Boolean).join(' · ');
  return {
    tienda: { nombre: ficha?.name ?? '', telefono: ficha?.mobile || ficha?.phone || null, direccion: direccion || null },
    productos: productos
      .map((p) => ({ ...p, loCompra: compra.has(p.templateId) }))
      .sort((a, b) => Number(b.loCompra) - Number(a.loCompra) || a.nombre.localeCompare(b.nombre)),
  };
}

/** La foto de un producto ASTA a la venta, en JPEG o PNG; `null` si no lo es o no tiene. */
export async function fotoDeProducto(templateId: number): Promise<Buffer | null> {
  const clave = String(templateId);
  const enCache = cacheFotos.get(clave);
  if (enCache !== undefined) return enCache;
  const [f] = await searchRead<{ name: string; image_1024: string | false }>('product.template', [['id', '=', templateId], ...ASTA_CON_FOTO], ['name', 'image_1024'], { limit: 1 });
  const r = f?.image_1024 && esNombreAsta(f.name) ? Buffer.from(f.image_1024, 'base64') : null;
  cacheFotos.set(clave, r);
  return r;
}

/** `image/jpeg` o `image/png`, por los primeros bytes: Odoo guarda las dos. */
export function tipoDeImagen(b: Buffer): string {
  return b[0] === 0x89 && b[1] === 0x50 ? 'image/png' : b[0] === 0x52 && b[1] === 0x49 ? 'image/webp' : 'image/jpeg';
}
