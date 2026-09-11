import { z } from 'zod';
import {
  portfolioRowSchema,
  portfolioMetaSchema,
  invoicingSummarySchema,
  apiErrorSchema,
  type PortfolioRow,
  type PortfolioMeta,
  type InvoicingSummary,
} from '@asta/shared-types';

/**
 * Cliente del middleware.
 *
 * SOLO SE USA DESDE EL SERVIDOR (Server Components y Route Handlers).
 *
 * Que el navegador no hable nunca con el middleware tiene tres consecuencias
 * que valen la pena:
 *
 *   · El token de sesión no llega al cliente. No hay nada que robar con XSS.
 *   · CORS deja de existir como problema: es una llamada servidor a servidor.
 *   · La URL del middleware no se publica. Solo Next sabe dónde está.
 *
 * Cada respuesta se valida contra el contrato de `@asta/shared-types`. Si el
 * middleware cambia la forma de un endpoint, el panel falla aquí, con un
 * mensaje que dice qué campo, en vez de reventar al pintar con un `undefined`.
 */

const MIDDLEWARE_URL = process.env.MIDDLEWARE_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Cuando el contrato y la respuesta no coinciden. Es un bug, no un fallo de red. */
export class ContractError extends Error {
  constructor(readonly endpoint: string, readonly detail: string) {
    super(`La respuesta de ${endpoint} no cumple el contrato: ${detail}`);
    this.name = 'ContractError';
  }
}

async function request<T extends z.ZodType>(
  path: string,
  schema: T,
  odooUserId: number,
): Promise<z.infer<T>> {
  let res: Response;

  try {
    res = await fetch(`${MIDDLEWARE_URL}${path}`, {
      headers: {
        // PROVISIONAL: cabecera de authDev. Cuando exista #17 esto pasa a ser
        // `Authorization: Bearer <jwt>` y es el único punto que cambia.
        'X-Dev-Odoo-User-Id': String(odooUserId),
      },
      // La cartera cambia poco dentro de una misma navegación, pero no tanto
      // como para arriesgar mostrar cifras viejas.
      next: { revalidate: 30 },
    });
  } catch {
    throw new ApiError('NETWORK', 'No se pudo contactar con el middleware.', 503);
  }

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const err = apiErrorSchema.safeParse(body);
    if (err.success) throw new ApiError(err.data.error.code, err.data.error.message, res.status);
    throw new ApiError('UNKNOWN', `El middleware devolvió ${res.status}.`, res.status);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ContractError(path, z.prettifyError(parsed.error).slice(0, 300));
  }
  return parsed.data;
}

// ─────────────────────────────────────────────────────────────────────────────

const portfolioSchema = z.object({
  data: z.array(portfolioRowSchema),
  meta: portfolioMetaSchema,
});

export interface Portfolio {
  filas: PortfolioRow[];
  meta: PortfolioMeta;
}

export async function getPortfolio(odooUserId: number): Promise<Portfolio> {
  const r = await request('/api/v1/salesperson/portfolio', portfolioSchema, odooUserId);
  return { filas: r.data, meta: r.meta };
}

const invoicingSchema = z.object({
  data: z.object({
    cliente: z.object({
      id: z.number(),
      nombre: z.string().optional(),
      tier: z.string().nullable().optional(),
    }),
    facturacion: invoicingSummarySchema,
  }),
  meta: z.looseObject({}),
});

export interface ClientInvoicing {
  cliente: { id: number; nombre?: string; tier?: string | null };
  facturacion: InvoicingSummary;
}

export async function getClientInvoicing(
  odooUserId: number,
  partnerId: number,
  opciones: { serieMensual?: boolean } = {},
): Promise<ClientInvoicing> {
  const qs = opciones.serieMensual ? '?incluirSerieMensual=true' : '';
  const r = await request(
    `/api/v1/salesperson/clients/${partnerId}/invoicing${qs}`,
    invoicingSchema,
    odooUserId,
  );
  return r.data;
}
