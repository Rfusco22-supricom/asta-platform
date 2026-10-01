import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { CrearPedidoBody, ErrorCode, PublicOrderDetail } from '@asta/shared-types';
import { prisma } from '../config/prisma.js';
import { executeKw, searchRead } from '../odoo/client.js';
import { almacenDelCliente, InventarioNoDisponible } from './inventory.service.js';
import { preciosDe, tarifaDelCliente } from './pricing.service.js';
import { verPedido } from './orders.service.js';

/**
 * `POST /api/v1/public/orders` (#33): el cliente crea un pedido, que nace en
 * BORRADOR y espera a que alguien de la empresa lo confirme. La API no confirma
 * ventas.
 *
 * ── Apagado por defecto ──────────────────────────────────────────────────────
 *
 * Es el único endpoint que escribe en Odoo, y sus pruebas contra un Odoo de
 * verdad crearían `sale.order` reales en producción. Hasta que haya una copia de
 * staging (#13) donde ensayarlo, `API_PEDIDOS_ESCRITURA` está apagado y la ruta
 * responde 501. Las pruebas de hoy usan un `EscritorPedidos` simulado y leen todo
 * lo demás —tarifa, precios, existencias— del Odoo real.
 *
 * ── Qué decide quién ─────────────────────────────────────────────────────────
 *
 *   · El cliente: el del token. `partner_id` lo fija `scopeToOwnPartner`.
 *   · La compañía y la tarifa: las del cliente, como en `/pricing`.
 *   · El precio: el de su tarifa. Odoo lo calcula al crear la línea; aquí solo
 *     se comprueba antes que lo haya. Mandarlo en el cuerpo es un 400.
 *   · El almacén: el que le vende, como en `/inventory`.
 *
 * ── Qué se valida antes de escribir ─────────────────────────────────────────
 *
 * Que cada referencia exista, sea de un solo producto y tenga precio en su
 * tarifa (`ORDER_LINES_INVALID`), y que haya existencia libre para la cantidad
 * pedida (`INSUFFICIENT_STOCK`). Cualquier fallo rechaza el pedido ENTERO, sin
 * escribir nada en Odoo: decidido en #33, para que un cliente no reciba medio
 * pedido sin darse cuenta.
 *
 * La existencia se comprueba, pero un borrador no la reserva: dos pedidos
 * simultáneos pueden pasar los dos. Es orientativa, y la confirmación interna
 * es la que decide.
 *
 * ── Lo que no se sabe cómo acabó ────────────────────────────────────────────
 *
 * Si Odoo RECHAZA el `create`, no se creó nada y la misma clave se reintenta.
 * Pero un tiempo agotado o una conexión cortada pueden haber creado el pedido
 * igualmente: entonces la clave se queda EN_CURSO y, pasado un margen, el
 * reintento busca en Odoo el pedido de ese cliente con ese `origin` antes de
 * crear otro (`reservarClave`). Sin esto, la idempotencia fallaba justo en el
 * caso para el que existe.
 */

/** ¿Está encendida la escritura? Getter, no constante: un test lo enciende sin recargar módulos. */
export function escrituraPedidosActiva(): boolean {
  const r = z.stringbool().safeParse(process.env.API_PEDIDOS_ESCRITURA ?? 'false');
  return r.success && r.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Quién escribe en Odoo
// ─────────────────────────────────────────────────────────────────────────────

export interface PedidoParaOdoo {
  partnerId: number;
  companyId: number;
  pricelistId: number;
  warehouseId: number;
  lineas: Array<{ productId: number; cantidad: number }>;
  referenciaCliente: string | null;
  /** Para rastrear en Odoo de dónde salió: `API Asta (<clave>)`. */
  origen: string;
}

/** Lo único de este fichero que escribe en Odoo. Se sustituye en las pruebas. */
export interface EscritorPedidos {
  crear(p: PedidoParaOdoo): Promise<number>;
  /**
   * El pedido que ya existe en Odoo para ese cliente con ese `origin`, si lo
   * hay. Para conciliar después de un fallo AMBIGUO (ver `reservarClave`):
   * `origin` lleva la `Idempotency-Key`, y con el cliente identifica el pedido.
   */
  buscar(partnerId: number, origen: string): Promise<number | null>;
}

/**
 * El de verdad. Sin `price_unit` en las líneas: Odoo lo pone desde la tarifa
 * del pedido, que es la del cliente. Mandarlo sería tener dos cálculos de
 * precio que pueden no coincidir.
 */
export const escritorOdoo: EscritorPedidos = {
  async crear(p) {
    return executeKw<number>(
      'sale.order',
      'create',
      [
        {
          partner_id: p.partnerId,
          company_id: p.companyId,
          pricelist_id: p.pricelistId,
          warehouse_id: p.warehouseId,
          client_order_ref: p.referenciaCliente || false,
          origin: p.origen,
          order_line: p.lineas.map((l) => [0, 0, { product_id: l.productId, product_uom_qty: l.cantidad }]),
        },
      ],
      { context: { allowed_company_ids: [p.companyId] } },
    );
  },
  async buscar(partnerId, origen) {
    // Como `verPedido`: sin contexto de compañía.
    const [f] = await searchRead<{ id: number }>('sale.order', [['partner_id', '=', partnerId], ['origin', '=', origen]], ['id'], {
      limit: 1,
      order: 'id asc',
    });
    return f?.id ?? null;
  },
};

/** El `origin` con que se marca en Odoo un pedido creado por la API. */
export const origenDe = (clave: string) => `API Asta (${clave})`;

/**
 * Cuánto hay que esperar, tras un fallo ambiguo, antes de conciliar con Odoo.
 *
 * El tiempo de espera del cliente XML-RPC es LOCAL (`ODOO_TIMEOUT_MS`): el
 * middleware deja de esperar, pero la petición sigue en Odoo y puede terminar
 * creando el pedido. Buscar en Odoo justo después no prueba nada, porque el
 * pedido puede aparecer un poco más tarde. El margen tiene que superar lo que
 * Odoo deja vivir una petición (en Odoo.sh, del orden de dos minutos).
 */
export function margenConciliacionMs(): number {
  const s = Number(process.env.API_PEDIDOS_MARGEN_CONCILIACION_S ?? 300);
  return (Number.isFinite(s) && s >= 0 ? s : 300) * 1000;
}

/**
 * ¿Es un NO de Odoo, o algo que no se sabe cómo acabó?
 *
 * Un fallo XML-RPC con `faultCode` es Odoo contestando que rechaza el `create`:
 * no se creó nada y reintentar es seguro. Cualquier otra cosa —tiempo agotado,
 * conexión cortada después de enviar— puede haber creado el pedido en Odoo.
 */
export function esRechazoDeOdoo(error: unknown): boolean {
  const causa = error && typeof error === 'object' ? (error as { cause?: unknown }).cause : undefined;
  const conFault = (e: unknown) => Boolean(e && typeof e === 'object' && 'faultCode' in e);
  return conFault(error) || conFault(causa);
}

let escritor: EscritorPedidos = escritorOdoo;

/** Solo para tests. Devuelve cómo deshacerlo. */
export function usarEscritorPedidos(e: EscritorPedidos): () => void {
  const anterior = escritor;
  escritor = e;
  return () => {
    escritor = anterior;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Errores
// ─────────────────────────────────────────────────────────────────────────────

class ErrorPedido extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    mensaje: string,
    readonly detalles?: Array<{ sku: string; motivo: string }>,
  ) {
    super(mensaje);
  }
}

export const sinClave = () =>
  new ErrorPedido(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Falta la cabecera Idempotency-Key: un valor único por pedido, de 1 a 128 caracteres. Reutilízalo solo para reintentar el mismo pedido.');

const claveReutilizada = () =>
  new ErrorPedido(409, 'IDEMPOTENCY_KEY_REUSED', 'Esa Idempotency-Key ya se usó con otro pedido. Usa una nueva para cada pedido distinto.');

const enCurso = () =>
  new ErrorPedido(
    409,
    'CONFLICT',
    'Ya hay una petición en curso con esa Idempotency-Key, o la anterior no llegó a confirmarse. Reintenta con la MISMA clave en unos minutos: si el pedido se creó, recibirás ese; si no, se creará. No uses otra clave o podrías duplicarlo.',
  );

// ─────────────────────────────────────────────────────────────────────────────
// Crear
// ─────────────────────────────────────────────────────────────────────────────

/** La `Idempotency-Key` aceptada: 1 a 128 caracteres visibles, sin espacios. */
export function claveValida(clave: string | undefined): clave is string {
  return typeof clave === 'string' && /^[\x21-\x7e]{1,128}$/.test(clave);
}

/** Huella del cuerpo. Con el mismo pedido en otro orden de claves JSON, la misma. */
export function huellaPedido(cuerpo: CrearPedidoBody): string {
  const normal = {
    lineas: cuerpo.lineas.map((l) => ({ sku: l.sku, cantidad: l.cantidad })),
    referenciaCliente: cuerpo.referenciaCliente ?? null,
  };
  return createHash('sha256').update(JSON.stringify(normal)).digest('hex');
}

export interface ContextoPedido {
  partnerId: number;
  apiKeyId: string | null;
  /** La tarifa copiada por el sync: solo para avisar si discrepa (ver `tarifaDelCliente`). */
  pricelistIdentidad: number | null;
  log?: { warn: (obj: unknown, msg?: string) => void };
}

export interface PedidoCreado {
  /** 201 si se creó ahora; 200 si es la repetición de uno ya creado con esa clave. */
  status: 200 | 201;
  cuerpo: { data: PublicOrderDetail };
}

export async function crearPedido(ctx: ContextoPedido, cuerpo: CrearPedidoBody, clave: string): Promise<PedidoCreado> {
  const huella = huellaPedido(cuerpo);
  const peticion = await reservarClave(ctx, clave, huella);
  if ('repetido' in peticion) return peticion.repetido;

  let orderId: number | null = null;
  let enOdoo = false;
  try {
    const { lineas, tarifa, almacen } = await validar(ctx, cuerpo);
    enOdoo = true;
    orderId = await escritor.crear({
      partnerId: ctx.partnerId,
      companyId: tarifa.companyId,
      pricelistId: tarifa.pricelistId,
      warehouseId: almacen.warehouseId,
      lineas,
      referenciaCliente: cuerpo.referenciaCliente ?? null,
      origen: origenDe(clave),
    });
    // CREADO antes de leerlo: desde aquí el pedido existe en Odoo, y un reintento
    // con la misma clave tiene que devolver ESTE, nunca crear otro.
    await prisma.apiOrderRequest.update({ where: { id: peticion.id }, data: { estado: 'CREADO', odooOrderId: orderId } });
    const respuesta = await respuestaDe(ctx.partnerId, orderId);
    await prisma.apiOrderRequest.update({ where: { id: peticion.id }, data: { respuesta: respuesta as unknown as Prisma.InputJsonValue } });
    return { status: 201, cuerpo: respuesta };
  } catch (error) {
    if (orderId === null && (!enOdoo || esRechazoDeOdoo(error))) {
      // Seguro que no se creó nada: o no se llegó a llamar a Odoo, o Odoo dijo
      // que no. La misma clave puede reintentarse.
      await prisma.apiOrderRequest.update({ where: { id: peticion.id }, data: { estado: 'FALLIDO' } }).catch(() => {});
    }
    // Si no, NO se marca FALLIDO: un tiempo agotado o una conexión cortada pueden
    // haber creado el pedido en Odoo. La fila se queda EN_CURSO y el reintento
    // concilia con Odoo pasado el margen (ver `reservarClave`). Marcarla FALLIDO
    // es lo que dejaba crear un segundo pedido con la misma clave.
    throw error;
  }
}

async function respuestaDe(partnerId: number, orderId: number): Promise<{ data: PublicOrderDetail }> {
  const pedido = await verPedido(partnerId, orderId);
  if (!pedido) throw new Error(`El pedido ${orderId} recién creado no es visible para el partner ${partnerId}`);
  return { data: pedido };
}

/**
 * Reserva `(cliente, clave)`. Si ya existe:
 *   · otro cuerpo                → IDEMPOTENCY_KEY_REUSED
 *   · el mismo, ya creado        → se devuelve lo mismo que entonces (200)
 *   · el mismo, todavía en curso → CONFLICT
 *   · el mismo, fallido          → se vuelve a intentar
 *
 * La unicidad la garantiza el índice de MySQL, no una lectura previa: dos
 * peticiones simultáneas con la misma clave no pueden crear dos pedidos.
 */
async function reservarClave(
  ctx: ContextoPedido,
  clave: string,
  huella: string,
): Promise<{ id: bigint } | { repetido: PedidoCreado }> {
  try {
    const fila = await prisma.apiOrderRequest.create({
      data: { odooPartnerId: ctx.partnerId, idempotencyKey: clave, requestHash: huella, apiKeyId: ctx.apiKeyId },
      select: { id: true },
    });
    return fila;
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
  }

  const previa = await prisma.apiOrderRequest.findUniqueOrThrow({
    where: { odooPartnerId_idempotencyKey: { odooPartnerId: ctx.partnerId, idempotencyKey: clave } },
  });
  if (previa.requestHash !== huella) throw claveReutilizada();
  if (previa.estado === 'CREADO' && previa.odooOrderId !== null) {
    const respuesta = (previa.respuesta as { data: PublicOrderDetail } | null) ?? (await respuestaDe(ctx.partnerId, previa.odooOrderId));
    return { repetido: { status: 200, cuerpo: respuesta } };
  }
  if (previa.estado === 'FALLIDO') {
    // De dos reintentos simultáneos, solo uno gana la fila.
    const { count } = await prisma.apiOrderRequest.updateMany({ where: { id: previa.id, estado: 'FALLIDO' }, data: { estado: 'EN_CURSO' } });
    if (count === 1) return { id: previa.id };
  }
  if (previa.estado === 'EN_CURSO' && Date.now() - previa.updatedAt.getTime() >= margenConciliacionMs()) {
    /*
     * EN_CURSO desde hace más que el margen: el intento anterior acabó sin saber
     * si Odoo creó el pedido —tiempo agotado, conexión cortada, el proceso se
     * cayó entre crearlo y apuntarlo—. Sin esto la clave respondía «en curso»
     * para siempre, y el cliente acababa usando otra y duplicando el pedido.
     *
     * Se concilia con Odoo. Primero se reclama la fila tocando `updatedAt`, para
     * que de dos reintentos simultáneos concilie solo uno.
     */
    const { count } = await prisma.apiOrderRequest.updateMany({
      where: { id: previa.id, estado: 'EN_CURSO', updatedAt: previa.updatedAt },
      data: { updatedAt: new Date() },
    });
    if (count === 1) {
      const existente = await escritor.buscar(ctx.partnerId, origenDe(clave));
      if (existente === null) return { id: previa.id };
      await prisma.apiOrderRequest.update({ where: { id: previa.id }, data: { estado: 'CREADO', odooOrderId: existente } });
      const respuesta = await respuestaDe(ctx.partnerId, existente);
      await prisma.apiOrderRequest.update({ where: { id: previa.id }, data: { respuesta: respuesta as unknown as Prisma.InputJsonValue } });
      return { repetido: { status: 200, cuerpo: respuesta } };
    }
  }
  throw enCurso();
}

async function validar(ctx: ContextoPedido, cuerpo: CrearPedidoBody) {
  const skus = cuerpo.lineas.map((l) => l.sku);
  const repetidos = skus.filter((s, i) => skus.indexOf(s) !== i);
  if (repetidos.length > 0) {
    throw new ErrorPedido(400, 'ORDER_LINES_INVALID', 'Hay referencias repetidas: junta sus cantidades en una sola línea.', [...new Set(repetidos)].map((sku) => ({ sku, motivo: 'sku_repetido' })));
  }

  const tarifa = await tarifaDelCliente(ctx.partnerId, ctx.pricelistIdentidad, ctx.log);
  const almacen = await almacenDelCliente(ctx.partnerId);
  if (!almacen) throw new InventarioNoDisponible(ctx.partnerId);

  const { precios } = await preciosDe(tarifa, skus, ctx.log);
  const invalidas = precios.filter((p) => p.motivo !== 'ok');
  if (invalidas.length > 0) {
    throw new ErrorPedido(400, 'ORDER_LINES_INVALID', 'Algunas líneas no se pueden pedir: mira `detalles`.', invalidas.map((p) => ({ sku: p.sku, motivo: p.motivo })));
  }

  // La existencia, en el momento: sin cache. La de `/inventory` puede tener 60 s.
  const productoDe = new Map(precios.map((p) => [p.sku, p.productId!]));
  const filas = await searchRead<{ id: number; free_qty: number }>(
    'product.product',
    [['id', 'in', [...productoDe.values()]]],
    ['free_qty'],
    { context: { warehouse: almacen.warehouseId, allowed_company_ids: [almacen.companyId] } },
  );
  const libre = new Map(filas.map((f) => [f.id, f.free_qty]));
  const sinExistencia = cuerpo.lineas.filter((l) => l.cantidad > (libre.get(productoDe.get(l.sku)!) ?? 0));
  if (sinExistencia.length > 0) {
    throw new ErrorPedido(
      409,
      'INSUFFICIENT_STOCK',
      'No hay existencia suficiente para algunas líneas. No se creó el pedido.',
      sinExistencia.map((l) => ({ sku: l.sku, motivo: 'sin_existencia_suficiente' })),
    );
  }

  return { tarifa, almacen, lineas: cuerpo.lineas.map((l) => ({ productId: productoDe.get(l.sku)!, cantidad: l.cantidad })) };
}
