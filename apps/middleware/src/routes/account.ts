import { Router } from 'express';
import { z } from 'zod';
import { DIAS_VENCE_PRONTO, FACTURAS_POR_PAGINA, cambioKioscoSchema, enviarPedidoSchema, vistaFacturasSchema, marcarVendidoSchema, mesSchema, nuevoCodigoClienteSchema, subirSellOutSchema } from '@asta/shared-types';
import { authJwt } from '../middleware/authJwt.js';
import { dePantalla } from '../services/pantallas.js';
import { autorizar } from '../middleware/autorizar.js';
import {
  deleteApiKey,
  getApiKeys,
  getApiKeyUsage,
  postApiKey,
} from '../controllers/apiKeys.controller.js';
import { auditContext } from '../middleware/auditContext.js';
import { recordAudit } from '../services/audit.service.js';
import { cambiarKiosco, codigoParaCliente, estadoCodigo, listarKioscos } from '../services/kioscos.service.js';
import { metricasDeCliente } from '../services/metricasCliente.service.js';
import { enviarPedido, pedidoSugerido, pedidosDelCliente } from '../services/pedidoSugerido.service.js';
import { getPartnerInvoice, listPartnerInvoices, resumenDeCobro } from '../services/invoicing.service.js';
import { buscarPdfDeFactura, leerPdf } from '../services/invoicePdf.service.js';
import { datosFlyer, fotoDeProducto, tipoDeImagen } from '../services/flyers.service.js';
import { comprobar, guardar, marcarVendido, mesDe, plantilla, porMarcar, resumenSellOut } from '../services/sellOut.service.js';

/**
 * Lo que un CLIENTE gestiona de su propia cuenta (issue #28).
 *
 * Router aparte de `/salesperson` y de `/admin` porque el público es otro: aquí
 * entra un BRONCE, un PLATA o un GOLD con su sesión del panel, no el personal de
 * Supricom. Mezclarlo con las rutas de vendedor habría puesto endpoints de dos
 * audiencias detrás del mismo prefijo, y el primer copiar-pegar de una ruta se
 * habría llevado el `autorizar()` de al lado, que es el equivocado.
 *
 * No confundir con `/api/v1/public`: eso es la API que se consume CON una key.
 * Esto es la pantalla donde esa key se crea, y va con sesión de navegador.
 *
 * `autorizar('apikeys.propias.gestionar')` comprueba el rol —la matriz se lo
 * niega a VENDEDOR y a SUPERADMIN— y el ámbito `identidad` lo aplica cada
 * servicio metiendo el `appUserId` dentro del `where`, igual que las sesiones
 * de #52. No hay ningún endpoint aquí que reciba de quién es lo que toca.
 */
export const accountRouter = Router();

accountRouter.use(authJwt());

const gestionarKeys = autorizar('apikeys.propias.gestionar');

accountRouter.get('/api-keys', gestionarKeys, getApiKeys);
accountRouter.post('/api-keys', gestionarKeys, postApiKey);
accountRouter.delete('/api-keys/:id', gestionarKeys, deleteApiKey);

/**
 * El historial va bajo la key y no en una ruta suelta de logs.
 *
 * Así la comprobación de propiedad es la misma que la de revocar, y no hay forma
 * de pedir «los últimos usos» sin decir de qué key: una ruta `/usage` global
 * habría necesitado su propio filtrado por dueño, escrito aparte.
 */
accountRouter.get('/api-keys/:id/usage', gestionarKeys, getApiKeyUsage);

// ─────────────────────────────────────────────────────────────────────────────
// Las tablets de SU tienda
// ─────────────────────────────────────────────────────────────────────────────
//
// El cliente vincula tablets con la aplicación ASTA para su propia tienda.
// Enseñan solo compatibilidades: no tienen almacén, y el cliente no puede
// elegir uno. Mismo ámbito `identidad` que las keys: el dueño sale del token
// (`odooPartnerId`), nunca de la petición, y una tablet ajena responde lo mismo
// que una que no existe.

const gestionarTablets = autorizar('tablets.propias.gestionar');
const idUuid = z.uuid();

accountRouter.get('/tablets', gestionarTablets, async (req, res, next) => {
  try {
    const { kioscos } = await listarKioscos(req.identity.odooPartnerId);
    res.json({ data: kioscos, meta: { odooDisponible: true } });
  } catch (error) {
    next(error);
  }
});

/** Un código de 6 dígitos para vincular una tablet. Sale una vez y caduca en minutos. */
accountRouter.post('/tablets/codigos', gestionarTablets, async (req, res, next) => {
  try {
    const cuerpo = nuevoCodigoClienteSchema.safeParse(req.body);
    if (!cuerpo.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: z.prettifyError(cuerpo.error) } });
      return;
    }
    const r = await codigoParaCliente(cuerpo.data, req.identity.odooPartnerId, req.identity.appUserId);
    recordAudit({
      action: 'kiosco.codigo_creado',
      ...auditContext(req),
      targetType: 'kiosk_codigos',
      targetId: r.id,
      metadata: { nombre: cuerpo.data.nombre, odooPartnerId: req.identity.odooPartnerId },
    });
    res.status(201).json({ data: r });
  } catch (error) {
    next(error);
  }
});

accountRouter.get('/tablets/codigos/:id', gestionarTablets, async (req, res, next) => {
  try {
    const id = idUuid.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Código no válido.' } });
      return;
    }
    res.json({ data: await estadoCodigo(id.data, req.identity.appUserId) });
  } catch (error) {
    next(error);
  }
});

/** Activar o desactivar una tablet propia. Desactivada, vuelve a pedir un código. */
accountRouter.patch('/tablets/:id', gestionarTablets, async (req, res, next) => {
  try {
    const id = idUuid.safeParse(req.params.id);
    const cuerpo = cambioKioscoSchema.safeParse(req.body);
    if (!id.success || !cuerpo.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Tablet o cambio no válido.' } });
      return;
    }
    const kiosco = await cambiarKiosco(id.data, cuerpo.data.activo, req.identity.odooPartnerId);
    recordAudit({
      action: cuerpo.data.activo ? 'kiosco.activado' : 'kiosco.desactivado',
      ...auditContext(req),
      targetType: 'kiosk_devices',
      targetId: id.data,
      metadata: { odooPartnerId: req.identity.odooPartnerId },
    });
    res.json({ data: kiosco });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Sus métricas
// ─────────────────────────────────────────────────────────────────────────────

/** Sus compras de ASTA, su nivel y sus tablets. El cliente sale del token. */
accountRouter.get('/metricas', autorizar('metricas.propias.ver'), async (req, res, next) => {
  try {
    res.json({ data: await metricasDeCliente(req.identity.odooPartnerId) });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Su sell-out
// ─────────────────────────────────────────────────────────────────────────────
//
// El cliente sube lo que vende de ASTA (ventas del mes o inventario al cierre)
// con la plantilla. Ver `sellOut.service`. El cliente sale del token.

const sellOut = autorizar('sellout.propio.gestionar');

accountRouter.get('/sellout', sellOut, async (req, res, next) => {
  try {
    res.json({ data: await resumenSellOut(req.identity.odooPartnerId) });
  } catch (error) {
    next(error);
  }
});

/** «Lo que te vendimos»: lo que nos compró, lo marcado como vendido y lo que le queda. */
accountRouter.get('/sellout/marcar', sellOut, async (req, res, next) => {
  try {
    const mes = req.query.mes === undefined ? mesDe(new Date()) : mesSchema.safeParse(req.query.mes).data;
    if (!mes) {
      res.status(400).json({ error: { code: 'INVALID_QUERY', message: 'El mes va como AAAA-MM.' } });
      return;
    }
    res.json({ data: await porMarcar(req.identity.odooPartnerId, mes) });
  } catch (error) {
    next(error);
  }
});

/** Cuántas vendió de un producto en el mes. Devuelve la lista otra vez, ya al día. */
accountRouter.post('/sellout/marcar', sellOut, async (req, res, next) => {
  try {
    const cuerpo = marcarVendidoSchema.safeParse(req.body);
    if (!cuerpo.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: z.prettifyError(cuerpo.error) } });
      return;
    }
    res.json({ data: await marcarVendido(req.identity.odooPartnerId, req.identity.appUserId, cuerpo.data) });
  } catch (error) {
    next(error);
  }
});

/** El Excel para rellenar, con los productos ASTA que compra. */
accountRouter.get('/sellout/plantilla', sellOut, async (req, res, next) => {
  try {
    const archivo = await plantilla(req.identity.odooPartnerId);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="sell-out-asta.xlsx"');
    res.send(archivo);
  } catch (error) {
    next(error);
  }
});

/** Comprueba el archivo sin guardar nada: qué filas valen y cuáles no. */
accountRouter.post('/sellout/comprobar', sellOut, async (req, res, next) => {
  try {
    const cuerpo = subirSellOutSchema.safeParse(req.body);
    if (!cuerpo.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: z.prettifyError(cuerpo.error) } });
      return;
    }
    const { lineas: _lineas, ...validacion } = await comprobar(req.identity.odooPartnerId, cuerpo.data.mes, cuerpo.data.tipo, cuerpo.data.nombre, cuerpo.data.archivo);
    res.json({ data: validacion });
  } catch (error) {
    next(error);
  }
});

/** Guarda el reporte si no tiene errores. Si los tiene, no guarda nada y los devuelve. */
accountRouter.post('/sellout', sellOut, async (req, res, next) => {
  try {
    const cuerpo = subirSellOutSchema.safeParse(req.body);
    if (!cuerpo.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: z.prettifyError(cuerpo.error) } });
      return;
    }
    const r = await guardar(req.identity.odooPartnerId, req.identity.appUserId, cuerpo.data);
    if (!r.reporte) {
      res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'El archivo tiene errores: no se guardó.' }, data: r.validacion });
      return;
    }
    recordAudit({
      action: 'sellout.subido',
      ...auditContext(req),
      targetType: 'sell_out_reportes',
      targetId: r.reporte.id,
      metadata: { mes: r.reporte.mes, tipo: r.reporte.tipo, filas: r.reporte.filas, odooPartnerId: req.identity.odooPartnerId },
    });
    res.status(201).json({ data: r.reporte });
  } catch (error) {
    next(error);
  }
});

// ── Pedido sugerido ─────────────────────────────────────────────────────────
//
// Lo que le sugerimos reponer de ASTA, y enviarlo a su vendedor. Ver
// `pedidoSugerido.service`. El cliente sale del token.

const pedidos = autorizar('pedido.propio.enviar');

accountRouter.get('/pedido-sugerido', pedidos, async (req, res, next) => {
  try {
    res.json({ data: await pedidoSugerido(req.identity.odooPartnerId, req.identity.odooPricelistId ?? null, req.log) });
  } catch (error) {
    next(error);
  }
});

accountRouter.get('/pedidos', pedidos, async (req, res, next) => {
  try {
    res.json({ data: await pedidosDelCliente(req.identity.odooPartnerId) });
  } catch (error) {
    next(error);
  }
});

accountRouter.post('/pedidos', pedidos, async (req, res, next) => {
  try {
    const cuerpo = enviarPedidoSchema.safeParse(req.body);
    if (!cuerpo.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: z.prettifyError(cuerpo.error) } });
      return;
    }
    const pedido = await enviarPedido(
      { partnerId: req.identity.odooPartnerId, appUserId: req.identity.appUserId, pricelistIdentidad: req.identity.odooPricelistId ?? null },
      cuerpo.data,
      req.log,
    );
    recordAudit({
      action: 'pedido.enviado',
      ...auditContext(req),
      targetType: 'pedidos_cliente',
      targetId: pedido.id,
      metadata: { odooPartnerId: pedido.partnerId, lineas: pedido.lineas.length, unidades: pedido.unidades },
    });
    res.status(201).json({ data: pedido });
  } catch (error) {
    next(error);
  }
});

// ── Mis facturas ────────────────────────────────────────────────────────────
//
// Lo que debe, lo que vence pronto y sus facturas, con el PDF. Las mismas
// facturas que la API pública (`listPartnerInvoices`): el cliente sale del
// token. Ver `facturasCliente.ts` en shared-types.

const facturas = autorizar('facturas.propias.leer');

accountRouter.get('/facturas', facturas, async (req, res, next) => {
  try {
    const vista = vistaFacturasSchema.safeParse(req.query.vista ?? 'pendientes');
    const pagina = Number(req.query.pagina ?? 1);
    if (!vista.success || !Number.isInteger(pagina) || pagina < 1 || pagina > 1000) {
      res.status(400).json({ error: { code: 'INVALID_QUERY', message: 'vista es «pendientes» o «todas», y pagina un número desde 1.' } });
      return;
    }
    const partnerId = req.identity.odooPartnerId;
    const [resumen, lista] = await Promise.all([
      resumenDeCobro(partnerId, DIAS_VENCE_PRONTO),
      listPartnerInvoices(partnerId, { soloPorPagar: vista.data === 'pendientes', limit: FACTURAS_POR_PAGINA, offset: (pagina - 1) * FACTURAS_POR_PAGINA }),
    ]);
    res.json({ data: { resumen, vista: vista.data, facturas: lista.facturas, pagina, total: lista.total } });
  } catch (error) {
    next(error);
  }
});

/**
 * El PDF de una de sus facturas, directamente: el panel ya tiene la sesión, no
 * hace falta el enlace firmado de la API. Una factura de otro cliente responde
 * igual que una que no existe, como en `/public/invoices/:id`.
 */
accountRouter.get('/facturas/:id/pdf', facturas, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const noEsta = () => res.status(404).json({ error: { code: 'INVOICE_NOT_FOUND', message: 'Factura no encontrada.' } });
    if (!Number.isInteger(id) || id <= 0) {
      noEsta();
      return;
    }
    const factura = await getPartnerInvoice(req.identity.odooPartnerId, id);
    if (!factura) {
      noEsta();
      return;
    }
    const pdf = await buscarPdfDeFactura(factura.id);
    if (!pdf) {
      res.status(404).json({ error: { code: 'INVOICE_PDF_NOT_AVAILABLE', message: 'Esta factura todavía no tiene PDF. Pídeselo a tu vendedor.' } });
      return;
    }
    const bytes = await leerPdf(pdf.adjuntoId);
    res.set({
      'Content-Type': 'application/pdf',
      // El nombre sale del folio, que lo pone Odoo, limpiado: nada que pueda romper la cabecera.
      'Content-Disposition': `attachment; filename="factura-${factura.folio.replace(/[^A-Za-z0-9._-]/g, '-')}.pdf"`,
      'Content-Length': String(bytes.length),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(bytes);
  } catch (error) {
    next(error);
  }
});

// ── Mis flyers ──────────────────────────────────────────────────────────────
//
// Los datos de su tienda y los productos ASTA con foto, para que su navegador
// dibuje el flyer. Ver `flyers.service`. El cliente sale del token.

const flyers = autorizar('flyers.propios.crear');

accountRouter.get('/flyers', flyers, async (req, res, next) => {
  try {
    const partnerId = req.identity.odooPartnerId;
    res.json({ data: await dePantalla(`cliente:${partnerId}:flyers`, () => datosFlyer(partnerId)) });
  } catch (error) {
    next(error);
  }
});

/** La foto de un producto ASTA a la venta. Otro producto, o sin foto: 404. */
accountRouter.get('/flyers/fotos/:templateId', flyers, async (req, res, next) => {
  try {
    const id = Number(req.params.templateId);
    const foto = Number.isInteger(id) && id > 0 ? await fotoDeProducto(id) : null;
    if (!foto) {
      res.status(404).json({ error: { code: 'PRODUCT_NOT_FOUND', message: 'Ese producto no tiene foto.' } });
      return;
    }
    res.set({ 'Content-Type': tipoDeImagen(foto), 'Content-Length': String(foto.length), 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
    res.end(foto);
  } catch (error) {
    next(error);
  }
});
