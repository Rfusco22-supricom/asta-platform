import {
  DIAS_COBERTURA,
  MAX_LINEAS_SUGERIDO,
  MAX_PEDIDOS_ABIERTOS,
  type AtenderPedido,
  type EnviarPedido,
  type ErrorCode,
  type EstadoPedidoCliente,
  type LineaSugerida,
  type PedidoCliente,
  type PedidoSugerido,
} from '@asta/shared-types';
import { prisma } from '../config/prisma.js';
import { searchRead } from '../odoo/client.js';
import { preciosDe, tarifaDelCliente } from './pricing.service.js';
import { catalogoAsta, ritmosDelCliente, type RitmoProducto } from './sellOut.service.js';

/**
 * El pedido sugerido de reposición (reglas en `@asta/shared-types`,
 * `pedidoSugerido.ts`): lo que el cliente debería volver a comprarnos de ASTA.
 *
 * El cliente lo ajusta y lo envía; se guarda en `pedidos_cliente` y NO se
 * escribe en Odoo. Lo recibe su vendedor (el de su ficha en Odoo al enviarlo),
 * que lo pasa a Odoo como cotización y lo marca aquí. Administración ve todos.
 */

export class PedidoNoValido extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  constructor(mensaje: string, code: ErrorCode = 'VALIDATION_ERROR') {
    super(mensaje);
    this.name = 'PedidoNoValido';
    this.code = code;
    this.status = code === 'NOT_FOUND' ? 404 : code === 'PARTNER_NOT_IN_PORTFOLIO' ? 403 : 400;
  }
}

interface Log {
  warn: (obj: unknown, msg?: string) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// La sugerencia
// ─────────────────────────────────────────────────────────────────────────────

/** Una línea, o `null` si no hace falta reponer ese producto. Sin precio todavía. */
export function sugerir(r: RitmoProducto): Omit<LineaSugerida, 'precio'> | null {
  if (r.ventaMensual !== null && r.quedan !== null) {
    if (r.ventaMensual <= 0) return null;
    const porDia = r.ventaMensual / 30;
    const sugeridas = Math.ceil(porDia * DIAS_COBERTURA - r.quedan - 1e-9);
    if (sugeridas < 1) return null;
    return { ...base(r), origen: 'SELLOUT', sugeridas, diasQueQuedan: Math.floor(r.quedan / porDia) };
  }
  const sugeridas = Math.ceil(r.compraMensual - r.compradoMes - 1e-9);
  if (sugeridas < 1) return null;
  return { ...base(r), origen: 'COMPRAS', sugeridas, diasQueQuedan: null };
}

function base(r: RitmoProducto) {
  const redondo = (n: number) => Math.round(n * 10) / 10;
  return {
    productId: r.productId,
    sku: r.sku,
    nombre: r.nombre,
    quedan: r.quedan,
    ventaMensual: r.ventaMensual === null ? null : redondo(r.ventaMensual),
    compraMensual: redondo(r.compraMensual),
  };
}

/** Los precios de su tarifa, por producto. Si no se pueden leer, sin precios: la sugerencia vale igual. */
async function preciosPorProducto(partnerId: number, pricelistIdentidad: number | null, productos: { productId: number; sku: string | null }[], log?: Log) {
  const r = new Map<number, number>();
  const skus = [...new Set(productos.map((p) => p.sku).filter((s): s is string => Boolean(s)))];
  if (skus.length === 0) return r;
  try {
    const tarifa = await tarifaDelCliente(partnerId, pricelistIdentidad, log);
    const { precios } = await preciosDe(tarifa, skus, log);
    for (const p of precios) if (p.productId !== null && p.precio !== null) r.set(p.productId, p.precio);
  } catch (error) {
    log?.warn({ partnerId, error: error instanceof Error ? error.message : String(error) }, 'pedido sugerido: sin precios');
  }
  return r;
}

export async function pedidoSugerido(partnerId: number, pricelistIdentidad: number | null, log?: Log, hoy = new Date()): Promise<PedidoSugerido> {
  const { conSellOut, productos } = await ritmosDelCliente(partnerId, hoy);
  const lineas = productos
    .map(sugerir)
    .filter((l): l is NonNullable<typeof l> => l !== null)
    // Lo que se acaba antes, primero; sin sell-out, lo que más compra.
    .sort((a, b) => (a.diasQueQuedan ?? Infinity) - (b.diasQueQuedan ?? Infinity) || b.sugeridas - a.sugeridas || a.nombre.localeCompare(b.nombre))
    .slice(0, MAX_LINEAS_SUGERIDO);
  const precios = await preciosPorProducto(partnerId, pricelistIdentidad, lineas, log);
  return { conSellOut, lineas: lineas.map((l) => ({ ...l, precio: precios.get(l.productId) ?? null })) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Enviarlo
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Su nombre y su vendedor en Odoo; el vendedor, el de la empresa si el contacto
 * no tiene. Si Odoo no contesta, el pedido se guarda igual, sin vendedor: lo ve
 * administración.
 */
async function fichaDelCliente(partnerId: number, log?: Log): Promise<{ nombre: string; vendedor: number | null }> {
  try {
    return await leerFicha(partnerId);
  } catch (error) {
    log?.warn({ partnerId, error: error instanceof Error ? error.message : String(error) }, 'pedido sugerido: sin ficha de Odoo');
    return { nombre: `Cliente #${partnerId}`, vendedor: null };
  }
}

async function leerFicha(partnerId: number): Promise<{ nombre: string; vendedor: number | null }> {
  type Fila = { id: number; name: string; user_id: [number, string] | false; commercial_partner_id: [number, string] | false };
  const [p] = await searchRead<Fila>('res.partner', [['id', '=', partnerId]], ['name', 'user_id', 'commercial_partner_id'], { context: { active_test: false } });
  if (!p) return { nombre: `Cliente #${partnerId}`, vendedor: null };
  let vendedor = p.user_id ? p.user_id[0] : null;
  if (vendedor === null && p.commercial_partner_id && p.commercial_partner_id[0] !== partnerId) {
    const [empresa] = await searchRead<Fila>('res.partner', [['id', '=', p.commercial_partner_id[0]]], ['user_id'], { context: { active_test: false } });
    vendedor = empresa?.user_id ? empresa.user_id[0] : null;
  }
  return { nombre: p.name, vendedor };
}

export async function enviarPedido(
  quien: { partnerId: number; appUserId: string; pricelistIdentidad: number | null },
  datos: EnviarPedido,
  log?: Log,
  hoy = new Date(),
): Promise<PedidoCliente> {
  const abiertos = await prisma.pedidoCliente.count({ where: { odooPartnerId: quien.partnerId, estado: 'ENVIADO' } });
  if (abiertos >= MAX_PEDIDOS_ABIERTOS) {
    throw new PedidoNoValido(`Ya tienes ${abiertos} pedidos sin atender. Espera a que tu vendedor los revise.`);
  }
  const repetidos = datos.lineas.length !== new Set(datos.lineas.map((l) => l.productId)).size;
  if (repetidos) throw new PedidoNoValido('Hay un producto repetido en el pedido.');

  const { porId } = await catalogoAsta();
  const fuera = datos.lineas.find((l) => !porId.has(l.productId));
  if (fuera) throw new PedidoNoValido(`El producto #${fuera.productId} no es de ASTA.`);

  const [ficha, sugerido] = await Promise.all([
    fichaDelCliente(quien.partnerId, log),
    // Solo para guardar qué se le sugirió: si falla, se envía igual.
    pedidoSugerido(quien.partnerId, quien.pricelistIdentidad, log, hoy).catch(() => null),
  ]);
  const sugeridas = new Map((sugerido?.lineas ?? []).map((l) => [l.productId, l.sugeridas]));
  const productos = datos.lineas.map((l) => ({ ...l, ...porId.get(l.productId)! }));
  const precios = await preciosPorProducto(quien.partnerId, quien.pricelistIdentidad, productos.map((p) => ({ productId: p.productId, sku: p.sku })), log);
  const conPrecio = productos.every((p) => precios.has(p.productId));
  const importe = conPrecio ? productos.reduce((s, p) => s + p.cantidad * precios.get(p.productId)!, 0) : null;

  const pedido = await prisma.pedidoCliente.create({
    data: {
      odooPartnerId: quien.partnerId,
      cliente: ficha.nombre.slice(0, 200),
      odooVendedorId: ficha.vendedor,
      nota: datos.nota || null,
      importeEstimado: importe === null ? null : Math.round(importe * 100) / 100,
      enviadoPor: quien.appUserId,
      lineas: {
        create: productos.map((p) => ({
          odooProductId: p.productId,
          sku: p.sku,
          nombre: p.nombre.slice(0, 255),
          cantidad: p.cantidad,
          sugeridas: sugeridas.get(p.productId) ?? null,
          precio: precios.get(p.productId) ?? null,
        })),
      },
    },
    include: { lineas: true },
  });
  return aPedido(pedido);
}

// ─────────────────────────────────────────────────────────────────────────────
// Verlos y atenderlos
// ─────────────────────────────────────────────────────────────────────────────

type FilaPedido = Awaited<ReturnType<typeof prisma.pedidoCliente.findFirstOrThrow<{ include: { lineas: true } }>>>;

function aPedido(p: FilaPedido): PedidoCliente {
  return {
    id: p.id,
    partnerId: p.odooPartnerId,
    cliente: p.cliente,
    enviadoEn: p.createdAt.toISOString(),
    estado: p.estado,
    nota: p.nota,
    importeEstimado: p.importeEstimado === null ? null : Number(p.importeEstimado),
    unidades: p.lineas.reduce((s, l) => s + l.cantidad, 0),
    folioOdoo: p.folioOdoo,
    motivo: p.motivo,
    atendidoEn: p.atendidoEn?.toISOString() ?? null,
    lineas: p.lineas.map((l) => ({
      productId: l.odooProductId,
      sku: l.sku,
      nombre: l.nombre,
      cantidad: l.cantidad,
      sugeridas: l.sugeridas,
      precio: l.precio === null ? null : Number(l.precio),
    })),
  };
}

/** Los últimos pedidos de un cliente, para que vea en qué quedaron. */
export async function pedidosDelCliente(partnerId: number): Promise<PedidoCliente[]> {
  const filas = await prisma.pedidoCliente.findMany({ where: { odooPartnerId: partnerId }, orderBy: { createdAt: 'desc' }, take: 10, include: { lineas: true } });
  return filas.map(aPedido);
}

/**
 * Los pedidos por atender (o los atendidos), de los más viejos a los más nuevos
 * los abiertos. `vendedor`: solo los de sus clientes; `null`, todos.
 */
export async function pedidosParaAtender(vendedor: number | null, estado: EstadoPedidoCliente): Promise<PedidoCliente[]> {
  const filas = await prisma.pedidoCliente.findMany({
    where: { estado, ...(vendedor === null ? {} : { odooVendedorId: vendedor }) },
    orderBy: { createdAt: estado === 'ENVIADO' ? 'asc' : 'desc' },
    take: 100,
    include: { lineas: true },
  });
  return filas.map(aPedido);
}

/** Lo pasa a Odoo o lo descarta. Una vez: un pedido atendido ya no cambia. */
export async function atenderPedido(id: string, datos: AtenderPedido, quien: { appUserId: string; vendedor: number | null }): Promise<PedidoCliente> {
  const pedido = await prisma.pedidoCliente.findUnique({ where: { id } });
  if (!pedido) throw new PedidoNoValido('Ese pedido no existe.', 'NOT_FOUND');
  if (quien.vendedor !== null && pedido.odooVendedorId !== quien.vendedor) {
    throw new PedidoNoValido('Ese pedido es de un cliente de otra cartera.', 'PARTNER_NOT_IN_PORTFOLIO');
  }
  // Solo si sigue abierto: dos personas marcándolo a la vez no se pisan.
  const { count } = await prisma.pedidoCliente.updateMany({
    where: { id, estado: 'ENVIADO' },
    data: {
      estado: datos.estado,
      folioOdoo: datos.estado === 'EN_ODOO' ? datos.folioOdoo || null : null,
      motivo: datos.estado === 'DESCARTADO' ? datos.motivo : null,
      atendidoPor: quien.appUserId,
      atendidoEn: new Date(),
    },
  });
  if (count === 0) throw new PedidoNoValido('Ese pedido ya estaba atendido.');
  return aPedido(await prisma.pedidoCliente.findUniqueOrThrow({ where: { id }, include: { lineas: true } }));
}
