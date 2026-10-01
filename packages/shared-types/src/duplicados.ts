import { z } from 'zod';
import { montoSchema, odooIdSchema } from './common.js';

/**
 * El informe de fusiones pendientes (#50).
 *
 * ── Qué contesta, y por qué no es el número del issue ────────────────────────
 *
 * El issue dice «61,8 % de los registros de cliente están duplicados». Es cierto
 * y con ese número no se puede hacer nada: suena a una migración de semanas, y
 * por eso lleva meses parado.
 *
 * La mayoría de esos duplicados son inofensivos —registros sin una sola factura,
 * o grupos donde toda la facturación está en un solo sitio— y el panel muestra
 * la cifra correcta. Lo que rompe el panel es mucho más pequeño: los grupos con
 * la facturación REPARTIDA. Ahí el vendedor abre un cliente y ve una fracción de
 * la relación comercial, con un número exacto para ese registro y falso como
 * retrato del cliente.
 *
 * Por eso este contrato lleva SOLO los grupos partidos y, aparte, el recuento de
 * los demás. Mandar los 272 grupos dejaría a la pantalla decidir cuáles importan,
 * que es justo la decisión que hay que tener tomada antes de que alguien se
 * ponga a fusionar.
 *
 * ── Lo que NO hay aquí ───────────────────────────────────────────────────────
 *
 * Ninguna forma de fusionar. Fusionar dos clientes no se deshace, toca
 * facturación emitida y mueve comisión de una cartera a otra: se hace en Odoo,
 * por alguien que conoce a los clientes. El panel dice por dónde empezar y
 * cuánto queda.
 */

/** Por qué dos registros se consideran el mismo cliente. */
export const motivoDuplicadoSchema = z.enum(['rif', 'nombre']);
export type MotivoDuplicado = z.infer<typeof motivoDuplicadoSchema>;

export const registroDuplicadoSchema = z.object({
  partnerId: odooIdSchema,
  nombre: z.string(),
  rif: z.string().nullable(),
  facturado: montoSchema,
  facturas: z.number().int().nonnegative(),
  vendedorNombre: z.string().nullable(),
  /** El registro con más facturación: el destino natural de la fusión. */
  esDestino: z.boolean(),
});

export type RegistroDuplicado = z.infer<typeof registroDuplicadoSchema>;

export const grupoDuplicadoSchema = z.object({
  /** RIF normalizado o nombre normalizado, según `motivo`. Identifica al grupo. */
  clave: z.string(),
  motivo: motivoDuplicadoSchema,
  /** Facturación sumada del grupo: lo que el vendedor debería ver. */
  montoTotal: montoSchema,
  /**
   * Lo que queda FUERA del registro con más facturación.
   *
   * Mide el trabajo de la fusión, no el daño: el daño es que ninguno de los
   * registros enseña la cifra buena.
   */
  montoFuera: montoSchema,
  conFacturas: z.number().int().nonnegative(),
  /**
   * Vendedores distintos dentro del grupo.
   *
   * Con más de uno, fusionar mueve facturación —y comisión— de una cartera a
   * otra. Es una conversación que hay que tener antes, no descubrirla después.
   */
  vendedores: z.array(z.string()),
  registros: z.array(registroDuplicadoSchema),
});

export type GrupoDuplicado = z.infer<typeof grupoDuplicadoSchema>;

export const informeDuplicadosSchema = z.object({
  /** Solo los grupos con la facturación repartida, de más dinero a menos. */
  grupos: z.array(grupoDuplicadoSchema),
  resumen: z.object({
    /** Clientes activos de primer nivel examinados. */
    registros: z.number().int().nonnegative(),
    grupos: z.number().int().nonnegative(),
    /** Grupos sin una sola factura: ruido. */
    sinFacturas: z.number().int().nonnegative(),
    /** Grupos con la facturación en un único registro: el panel muestra bien. */
    inocuos: z.number().int().nonnegative(),
    /** Grupos con la facturación repartida: aquí se rompe el panel. */
    partidos: z.number().int().nonnegative(),
    montoPartido: montoSchema,
    montoTotalFacturado: montoSchema,
    /** De los partidos, cuántos cruzan carteras de vendedores distintos. */
    partidosEntreVendedores: z.number().int().nonnegative(),
  }),
  /**
   * Cuántas fusiones hacen falta para cubrir cada porcentaje del dinero
   * repartido.
   *
   * Es lo que convierte el informe en una tarea con final: no «hay 139 grupos
   * rotos» sino «con 20 fusiones arreglas el 90 %».
   */
  fusionesPara: z.array(
    z.object({
      porcentaje: z.number().int().min(1).max(100),
      fusiones: z.number().int().nonnegative(),
    }),
  ),
});

export type InformeDuplicados = z.infer<typeof informeDuplicadosSchema>;

export const informeDuplicadosRespuestaSchema = z.object({
  data: informeDuplicadosSchema,
  meta: z.object({
    generadoEn: z.iso.datetime(),
    duracionMs: z.number().int().nonnegative(),
    /** true si lo servido venía de la cache y no de Odoo en esta petición. */
    desdeCache: z.boolean(),
  }),
});

export type InformeDuplicadosRespuesta = z.infer<typeof informeDuplicadosRespuestaSchema>;
