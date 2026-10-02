import { z } from 'zod';
import { montoSchema, odooDateSchema, odooIdSchema } from './common.js';

/**
 * Cómo está la cartera de un vendedor, cliente a cliente: si compra, cuánto vale
 * y hacia dónde va. Es lo que la pantalla «Mi cartera» pinta junto a los totales.
 *
 * ── Por qué va aparte de `/portfolio` ────────────────────────────────────────
 *
 * Cuesta. La serie de doce meses de 796 clientes son ~4,7 s contra Odoo, y la
 * cartera ya tarda lo suyo. Separada, la tabla sale enseguida y esto llega
 * después; el middleware la guarda unos minutos por vendedor.
 *
 * ── Dos clasificaciones, porque responden a dos preguntas ────────────────────
 *
 *   · `estado` — ¿sigue comprando? Por la fecha de su última factura.
 *   · `clase`  — ¿cuánto pesa? ABC por lo facturado en doce meses: A son los
 *     que suman el 80 % de las ventas del vendedor, B el 15 % siguiente, C el
 *     resto.
 *
 * El nivel de tarifa (Bronce/Plata/Gold) no entra: hoy todos los clientes están
 * en la misma tarifa y saldrían todos Bronce. Ver #131.
 */

export const estadoClienteSchema = z.enum(['activo', 'nuevo', 'en_riesgo', 'dormido', 'prospecto']);
export type EstadoCliente = z.infer<typeof estadoClienteSchema>;

export const claseClienteSchema = z.enum(['A', 'B', 'C']);
export type ClaseCliente = z.infer<typeof claseClienteSchema>;

export const actividadClienteSchema = z.object({
  partnerId: odooIdSchema,
  /** Fecha de su última factura. null = nunca se le ha facturado. */
  ultimaCompra: odooDateSchema.nullable(),
  /** Fecha de su primera factura. */
  primeraCompra: odooDateSchema.nullable(),
  diasSinComprar: z.number().int().nonnegative().nullable(),
  estado: estadoClienteSchema,
  /** null = no ha facturado nada en los últimos doce meses. */
  clase: claseClienteSchema.nullable(),
  /** Facturado en los últimos doce meses, neto de devoluciones. */
  facturado12m: montoSchema,
  /** Un importe por mes, de `meta.meses[0]` al mes en curso. */
  serie: z.array(montoSchema),
  /**
   * Variación, en %, de los tres últimos meses COMPLETOS frente a los tres
   * anteriores. null si en esos tres anteriores no compró: no hay con qué
   * comparar, y un «+∞ %» no le dice nada a nadie.
   */
  tendencia: z.number().nullable(),
});

export type ActividadCliente = z.infer<typeof actividadClienteSchema>;

export const actividadCarteraRespuestaSchema = z.object({
  data: z.array(actividadClienteSchema),
  meta: z.object({
    /** Los meses de `serie`, "2026-01", del más antiguo al actual. */
    meses: z.array(z.string()),
    /** Días sin comprar a partir de los que un cliente pasa a cada estado. */
    umbrales: z.object({
      enRiesgo: z.number().int().positive(),
      dormido: z.number().int().positive(),
      /** Un cliente es «nuevo» si su primera factura es de hace menos de esto. */
      nuevo: z.number().int().positive(),
    }),
    generadoEn: z.iso.datetime(),
    /** true si sale de la caché del middleware: puede tener unos minutos. */
    desdeCache: z.boolean(),
  }),
});

export type ActividadCartera = z.infer<typeof actividadCarteraRespuestaSchema>;
