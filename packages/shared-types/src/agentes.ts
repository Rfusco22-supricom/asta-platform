import { z } from 'zod';
import { montoSchema, odooIdSchema } from './common.js';

/**
 * Estadísticas de los agentes de venta. Panel de administración.
 *
 * Junta en una sola fila lo que hasta ahora vivía en dos sitios distintos: la
 * cartera y la facturación, que salen de Odoo, y si esa persona puede entrar al
 * panel, que sale de MySQL.
 *
 * No están juntas por comodidad. La persona con la cartera más grande de la
 * empresa —260 clientes, 2,5 M facturados— no tenía cuenta, y eso no se veía en
 * ninguna pantalla: la de usuarios enseña quién no puede entrar sin decir cuánto
 * vende, y la de reconciliación cuenta clientes sin mirar al comercial.
 */

export const cuentaAgenteSchema = z.object({
  email: z.string(),
  activa: z.boolean(),
  /** false = la cuenta existe pero nadie le ha puesto contraseña. */
  puedeEntrar: z.boolean(),
  ultimoAcceso: z.iso.datetime().nullable(),
});

export const agenteSchema = z.object({
  odooUserId: odooIdSchema,
  nombre: z.string(),
  /**
   * El login de Odoo, SIN validar como correo.
   *
   * Por lo mismo que en `portfolioRowSchema`: se pinta, no se usa para escribir
   * a nadie, y un dato feo en el ERP no puede tirar la pantalla entera. Ahí ya
   * costó que un vendedor no viera ninguno de sus 161 clientes.
   */
  login: z.string(),
  activoEnOdoo: z.boolean(),

  clientes: z.number().int().nonnegative(),
  /** De esos, cuántos han comprado alguna vez. El resto es cartera por trabajar. */
  conCompra: z.number().int().nonnegative(),

  facturado: montoSchema,
  porCobrar: montoSchema,
  facturas: z.number().int().nonnegative(),

  /** null = no tiene cuenta en el panel. */
  cuenta: cuentaAgenteSchema.nullable(),
});

export type Agente = z.infer<typeof agenteSchema>;

export const agentesRespuestaSchema = z.object({
  data: z.array(agenteSchema),
  meta: z.object({
    agentes: z.number().int().nonnegative(),
    clientes: z.number().int().nonnegative(),
    facturado: montoSchema,
    porCobrar: montoSchema,
    /** Activos en Odoo que no pueden usar el panel. */
    sinAcceso: z.number().int().nonnegative(),
    generadoEn: z.iso.datetime(),
    duracionMs: z.number().int().nonnegative(),
  }),
});

export type AgentesRespuesta = z.infer<typeof agentesRespuestaSchema>;
