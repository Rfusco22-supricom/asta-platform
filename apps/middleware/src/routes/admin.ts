import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authJwt } from '../middleware/authJwt.js';
import { autorizar } from '../middleware/autorizar.js';
import { marcarHuerfanos, sincronizarPartners } from '../services/sync.service.js';
import { prisma } from '../config/prisma.js';

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
