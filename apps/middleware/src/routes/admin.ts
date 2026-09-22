import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authJwt } from '../middleware/authJwt.js';
import { autorizar } from '../middleware/autorizar.js';
import { marcarHuerfanos, sincronizarPartners } from '../services/sync.service.js';
import { reconciliar, resincronizarUno } from '../services/reconciliation.service.js';
import { crearInvitacion, listarSinAcceso, InvitacionInvalida } from '../services/invitation.service.js';
import { estadisticasAgentes } from '../services/agentes.service.js';
import { reporte } from '../services/reportes.service.js';
import { rangoDeLaPeticion } from '../services/rango.js';
import { oportunidadesAsta } from '../services/asta.service.js';
import { prisma } from '../config/prisma.js';
import { z } from 'zod';
import {
  nuevaCompatibilidadSchema,
  nuevoAliasSchema,
  printerSearchQuerySchema,
  revisionDecisionSchema,
  revisionImpresorasDecisionSchema,
  revisionQuerySchema,
  tipoCartuchoCambioSchema,
} from '@asta/shared-types';
import { aplicarRevision, corregirTipoCartucho, listarParaRevision } from '../services/recomendador/revision.service.js';
import { estadisticasRecomendador } from '../services/recomendador/estadisticas.service.js';
import {
  anadirAlias,
  anadirCompatibilidad,
  aplicarRevisionImpresoras,
  listarImpresorasParaRevision,
} from '../services/recomendador/revisionImpresoras.service.js';
import { buscarImpresorasPanel } from '../services/recomendador/recomendador.service.js';
import { recordAudit } from '../services/audit.service.js';
import { auditContext } from '../middleware/auditContext.js';

/**
 * Operaciones de administración. Solo SUPERADMIN.
 *
 * La sincronización normal la dispara un cron (`pnpm sync:partners`). Esto es
 * para el botón "sincronizar ahora" del panel, cuando alguien acaba de cambiar
 * algo en Odoo y no quiere esperar 15 minutos.
 */
export const adminRouter = Router();

/**
 * Un límite bajo a propósito.
 *
 * Una sincronización completa son ~3000 lecturas contra Odoo. Sin freno, pulsar
 * el botón cinco veces seguidas convierte el panel en un ataque contra el ERP
 * del que depende toda la empresa.
 */
const limiteSync = rateLimit({
  windowMs: 5 * 60_000,
  limit: 3,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: { code: 'RATE_LIMITED', message: 'Espera unos minutos entre sincronizaciones.' },
  },
});

adminRouter.use(authJwt());

adminRouter.post('/sync/partners', autorizar('admin.sync.ejecutar'), limiteSync, async (req, res, next) => {
  try {
    const completo = req.query.completo === 'true';
    const resumen = await sincronizarPartners({ completo });
    res.json({
      data: resumen,
      meta: { fuente: 'odoo:res.partner', modo: completo ? 'completo' : 'incremental' },
    });
  } catch (error) {
    // "Ya hay una sincronización en curso" es un 409, no un 500: no es un
    // fallo, es que la operación no procede ahora mismo.
    if (error instanceof Error && /en curso/i.test(error.message)) {
      res.status(409).json({ error: { code: 'CONFLICT', message: error.message } });
      return;
    }
    next(error);
  }
});

adminRouter.post('/sync/orphans', autorizar('admin.sync.ejecutar'), limiteSync, async (_req, res, next) => {
  try {
    res.json({ data: await marcarHuerfanos() });
  } catch (error) {
    next(error);
  }
});

/** Estado de la última sincronización, para pintarlo en el panel. */
adminRouter.get('/sync/status', autorizar('admin.sync.estado.ver'), async (_req, res, next) => {
  try {
    const [estado, porEstado] = await Promise.all([
      prisma.syncState.findUnique({ where: { entidad: 'res.partner' } }),
      prisma.appUser.groupBy({ by: ['syncStatus'], _count: true }),
    ]);

    res.json({
      data: {
        ultimaEjecucion: estado?.ultimaEjecucion ?? null,
        ultimoWriteDate: estado?.ultimoWriteDate ?? null,
        ejecutando: estado?.ejecutando ?? false,
        resumen: estado?.resumen ?? null,
        usuariosPorEstado: Object.fromEntries(
          porEstado.map((g) => [g.syncStatus, g._count]),
        ),
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Informe de reconciliación Odoo ↔ middleware.
 *
 * Lee ~3000 filas de cada lado y las compara en memoria. Va con el mismo
 * limitador que el sync: no es una consulta barata y no tiene sentido pedirla
 * cada pocos segundos.
 */
adminRouter.get(
  '/reconciliation',
  autorizar('admin.reconciliacion.ver'),
  limiteSync,
  async (_req, res, next) => {
    try {
      res.json({ data: await reconciliar(), meta: { fuente: 'odoo:res.partner + mysql' } });
    } catch (error) {
      next(error);
    }
  },
);

/** Resincroniza un partner suelto, para cuando alguien acaba de arreglarlo. */
adminRouter.post(
  '/reconciliation/resync/:partnerId',
  autorizar('admin.sync.ejecutar'),
  async (req, res, next) => {
    try {
      const partnerId = Number(req.params.partnerId);
      if (!Number.isInteger(partnerId) || partnerId <= 0) {
        res.status(400).json({
          error: { code: 'INVALID_PARTNER_ID', message: 'partnerId inválido' },
        });
        return;
      }

      const r = await resincronizarUno(partnerId);
      // 422 y no 400: la petición está bien formada, pero el dato en Odoo no
      // permite crear la cuenta. Quien lo lea tiene que ir a arreglar Odoo, no
      // a corregir su llamada.
      res.status(r.ok ? 200 : 422).json(
        r.ok ? { data: r } : { error: { code: 'CONFLICT', message: r.mensaje } },
      );
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Cuota de ASTA frente a la competencia, en toda la empresa.
 *
 * La versión acotada a la propia cartera vive en `/salesperson/asta`, con su
 * propia acción. No es el mismo endpoint mirando el rol: ver la nota de
 * `asta.propias.ver` en la matriz.
 */
adminRouter.get('/asta', autorizar('admin.asta.ver'), async (req, res, next) => {
  try {
    const r = await oportunidadesAsta();
    res.json({
      data: r.oportunidades,
      meta: { ...r.totales, generadoEn: r.generadoEn, duracionMs: r.duracionMs },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Estadísticas de los agentes de venta (#96).
 *
 * Sin límite de frecuencia propio: son ~12 llamadas a Odoo, comparable a la
 * cartera de un vendedor, y es una pantalla que se mira, no un trabajo que se
 * dispara. El informe de reconciliación sí lo lleva porque recorre el ERP
 * entero.
 */
adminRouter.get('/agentes', autorizar('admin.agentes.ver'), async (req, res, next) => {
  try {
    const r = await estadisticasAgentes();
    res.json({
      data: r.agentes,
      meta: { ...r.totales, generadoEn: r.generadoEn, duracionMs: r.duracionMs },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Reportes de facturación de toda la empresa.
 *
 * Ruta APARTE de la del vendedor, con su propio permiso, por lo mismo que en
 * ASTA: un único endpoint que mirara el rol para decidir cuánto enseña es donde
 * acaba colándose la facturación de la empresa en la pantalla de un comercial.
 * Esta ruta no sabe acotar por cartera; la del vendedor no sabe no hacerlo.
 */
adminRouter.get('/reportes', autorizar('admin.reportes.ver'), async (req, res, next) => {
  try {
    const rango = rangoDeLaPeticion(req.query as Record<string, unknown>);
    res.json(await reporte(rango));
  } catch (error) {
    next(error);
  }
});

/** Cuentas activas que todavia no pueden entrar: candidatas a invitar. */
adminRouter.get('/users/without-access', autorizar('admin.usuarios.gestionar'), async (req, res, next) => {
  try {
    const limite = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    const { usuarios, total } = await listarSinAcceso(limite);
    res.json({ data: usuarios, meta: { total, mostrados: usuarios.length } });
  } catch (error) {
    next(error);
  }
});

/**
 * Genera un enlace de invitación.
 *
 * Devuelve la URL para que el administrador la entregue como pueda mientras no
 * haya SMTP. El enlace es un secreto de un solo uso: se muestra una vez y no se
 * puede volver a consultar.
 */
adminRouter.post('/users/:userId/invite', autorizar('admin.usuarios.gestionar'), async (req, res, next) => {
  try {
    const base = process.env.WEB_APP_ORIGIN ?? 'http://localhost:3000';
    const inv = await crearInvitacion(String(req.params.userId), base, req.identity.appUserId, req.ip);
    res.json({
      data: inv,
      meta: {
        entrega: 'manual',
        nota: 'Sin SMTP configurado: copia el enlace y entrégalo tú. Caduca en 7 días y solo sirve una vez.',
      },
    });
  } catch (error) {
    if (error instanceof InvitacionInvalida) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Ese usuario no existe.' } });
      return;
    }
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Estadísticas del recomendador (#43)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Qué buscan los clientes, qué no encuentran y dónde se pierden ventas.
 * `?desde=&hasta=` como los reportes; sin ellos, los últimos doce meses.
 */
adminRouter.get('/recomendador/estadisticas', autorizar('admin.recomendador.ver'), async (req, res, next) => {
  try {
    const rango = rangoDeLaPeticion(req.query as Record<string, unknown>);
    res.json({ data: await estadisticasRecomendador(rango) });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Revisión de compatibilidades (#56)
// ─────────────────────────────────────────────────────────────────────────────

/** Propuestas producto → cartucho, lo más vendido primero. */
adminRouter.get('/compatibilidades/productos', autorizar('admin.compatibilidades.revisar'), async (req, res, next) => {
  try {
    const consulta = revisionQuerySchema.safeParse(req.query);
    if (!consulta.success) {
      res.status(400).json({ error: { code: 'INVALID_QUERY', message: z.prettifyError(consulta.error) } });
      return;
    }
    res.json(await listarParaRevision(consulta.data));
  } catch (error) {
    next(error);
  }
});

/**
 * Validar, rechazar o devolver a pendiente una o varias filas.
 *
 * Todo o nada: si alguna ya no está en el estado que se vio en pantalla, 409 y
 * no se toca ninguna. Ver `aplicarRevision`.
 */
adminRouter.post('/compatibilidades/productos/revision', autorizar('admin.compatibilidades.revisar'), async (req, res, next) => {
  try {
    const cuerpo = revisionDecisionSchema.safeParse(req.body);
    if (!cuerpo.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: z.prettifyError(cuerpo.error) } });
      return;
    }
    const r = await aplicarRevision(cuerpo.data, req.identity.appUserId);
    recordAudit({
      action: 'compatibilidad.revisada',
      ...auditContext(req),
      targetType: 'product_cartridges',
      targetId: cuerpo.data.filas.length === 1 ? `${cuerpo.data.filas[0].templateId}:${cuerpo.data.filas[0].cartridgeId}` : null,
      metadata: {
        decision: cuerpo.data.decision,
        relacion: cuerpo.data.relacion ?? null,
        filas: cuerpo.data.filas.map((f) => ({ templateId: f.templateId, cartridgeId: f.cartridgeId, antes: f.estadoEsperado })),
      },
    });
    res.json({ data: r });
  } catch (error) {
    next(error);
  }
});

/** Corrige el tipo de un cartucho (tóner, tinta, tambor, otro), en todos sus productos. */
adminRouter.patch('/compatibilidades/cartuchos/:cartridgeId', autorizar('admin.compatibilidades.revisar'), async (req, res, next) => {
  try {
    const id = z.coerce.number().int().positive().max(4_294_967_295).safeParse(req.params.cartridgeId);
    const cuerpo = tipoCartuchoCambioSchema.safeParse(req.body);
    if (!id.success || !cuerpo.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Cartucho o tipo no válido.' } });
      return;
    }
    const { anterior } = await corregirTipoCartucho(id.data, cuerpo.data.tipo);
    recordAudit({
      action: 'cartucho.tipo_corregido',
      ...auditContext(req),
      targetType: 'cartridges',
      targetId: String(id.data),
      metadata: { antes: anterior, despues: cuerpo.data.tipo },
    });
    res.json({ data: { cartridgeId: id.data, tipo: cuerpo.data.tipo } });
  } catch (error) {
    next(error);
  }
});

/** Tramo impresora → cartucho: cartuchos con sus impresoras, lo más vendido primero. */
adminRouter.get('/compatibilidades/impresoras', autorizar('admin.compatibilidades.revisar'), async (req, res, next) => {
  try {
    const consulta = revisionQuerySchema.safeParse(req.query);
    if (!consulta.success) {
      res.status(400).json({ error: { code: 'INVALID_QUERY', message: z.prettifyError(consulta.error) } });
      return;
    }
    res.json(await listarImpresorasParaRevision(consulta.data));
  } catch (error) {
    next(error);
  }
});

/** Validar, rechazar o devolver a pendiente relaciones impresora → cartucho. Todo o nada. */
adminRouter.post('/compatibilidades/impresoras/revision', autorizar('admin.compatibilidades.revisar'), async (req, res, next) => {
  try {
    const cuerpo = revisionImpresorasDecisionSchema.safeParse(req.body);
    if (!cuerpo.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: z.prettifyError(cuerpo.error) } });
      return;
    }
    const r = await aplicarRevisionImpresoras(cuerpo.data, req.identity.appUserId);
    recordAudit({
      action: 'compatibilidad.revisada',
      ...auditContext(req),
      targetType: 'cartridge_printer_models',
      targetId: cuerpo.data.filas.length === 1 ? `${cuerpo.data.filas[0].cartridgeId}:${cuerpo.data.filas[0].printerModelId}` : null,
      metadata: {
        decision: cuerpo.data.decision,
        filas: cuerpo.data.filas.map((f) => ({ cartridgeId: f.cartridgeId, printerModelId: f.printerModelId, antes: f.estadoEsperado })),
      },
    });
    res.json({ data: r });
  } catch (error) {
    next(error);
  }
});

/**
 * Añadir una compatibilidad. Desde ESTA ruta nace VALIDADA: la añade un
 * administrador, que es quien valida. La del vendedor vive en
 * `/salesperson/compatibilidades` y solo sabe proponer.
 */
adminRouter.post('/compatibilidades/impresoras', autorizar('admin.compatibilidades.revisar'), async (req, res, next) => {
  try {
    const cuerpo = nuevaCompatibilidadSchema.safeParse(req.body);
    if (!cuerpo.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: z.prettifyError(cuerpo.error) } });
      return;
    }
    const r = await anadirCompatibilidad(cuerpo.data, { autorId: req.identity.appUserId, validar: true });
    if (r.creada) {
      recordAudit({
        action: 'compatibilidad.anadida',
        ...auditContext(req),
        targetType: 'cartridge_printer_models',
        targetId: `${r.cartridgeId}:${r.printerModelId}`,
        metadata: { ...cuerpo.data, estado: r.estado, impresoraNueva: r.impresoraNueva, cartuchoNuevo: r.cartuchoNuevo },
      });
    }
    res.status(r.creada ? 201 : 200).json({ data: r });
  } catch (error) {
    next(error);
  }
});

/**
 * Impresoras que coinciden con lo tecleado, para atarles un alias (#43).
 *
 * Misma REGLA de búsqueda que el kiosco, pero sobre todas las impresoras
 * activas: hay que poder atarle un alias a una recién importada, que el kiosco
 * todavía no enseña. Cada fila dice si el kiosco la ve.
 */
adminRouter.get('/compatibilidades/impresoras/buscar', autorizar('admin.compatibilidades.revisar'), async (req, res, next) => {
  try {
    const q = printerSearchQuerySchema.safeParse(req.query);
    if (!q.success) {
      res.status(400).json({ error: { code: 'INVALID_QUERY', message: z.prettifyError(q.error) } });
      return;
    }
    const r = await buscarImpresorasPanel(q.data.q, q.data.limit);
    res.json({ data: r.impresoras, sugerencias: r.sugerencias });
  } catch (error) {
    next(error);
  }
});

/** Ata una búsqueda sin resultado a una impresora, como alias (#43). */
adminRouter.post('/compatibilidades/alias', autorizar('admin.compatibilidades.revisar'), async (req, res, next) => {
  try {
    const cuerpo = nuevoAliasSchema.safeParse(req.body);
    if (!cuerpo.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: z.prettifyError(cuerpo.error) } });
      return;
    }
    const r = await anadirAlias(cuerpo.data);
    if (r.creado) {
      recordAudit({
        action: 'alias.anadido',
        ...auditContext(req),
        targetType: 'printer_model_aliases',
        targetId: String(r.printerModelId),
        metadata: { alias: r.alias, fuente: 'BUSQUEDA' },
      });
    }
    res.status(r.creado ? 201 : 200).json({ data: r });
  } catch (error) {
    next(error);
  }
});
