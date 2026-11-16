import { z } from 'zod';

/**
 * Lo que un puente del CLIENTE devuelve al navegador: solo lo que dice el
 * contrato, y nada más.
 *
 * El middleware ya responde a un cliente solo con lo suyo; esto es la segunda
 * barrera. Un campo que alguien añada a la respuesta del middleware sin querer
 * (una nota interna, el vendedor, un costo) no llega al navegador del cliente
 * hasta que se añade también al esquema de `shared-types`: `z.object` quita lo
 * que no conoce.
 *
 *   · Éxito: se valida con `exito`. Si no encaja, no se reenvía nada (502): ante
 *     la duda, no se enseña.
 *   · Error: solo `code` y `message` (y `data` si `datosDelError` lo describe,
 *     como las filas con errores de un sell-out que no se guardó).
 *
 * Sin Next a propósito: la prueba (`scripts/filtrarCuerpo.test.ts`) corre en la
 * raíz. La respuesta HTTP la arma `filtrar.ts`.
 */

const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

export interface CuerpoFiltrado {
  status: number;
  body: unknown;
  /** Por qué no encajó la respuesta de éxito, para el log. */
  descartado?: string;
}

export function cuerpoFiltrado(status: number, body: unknown, exito: z.ZodType, datosDelError?: z.ZodType): CuerpoFiltrado {
  if (status >= 200 && status < 300) {
    const limpio = exito.safeParse(body);
    if (limpio.success) return { status, body: limpio.data };
    return {
      status: 502,
      body: { error: { code: 'INTERNAL_ERROR', message: 'Respuesta inesperada del servidor.' } },
      descartado: z.prettifyError(limpio.error),
    };
  }

  const error = errorSchema.safeParse(body);
  const salida: { error: { code: string; message: string }; data?: unknown } = error.success
    ? { error: { code: error.data.error.code, message: error.data.error.message } }
    : { error: { code: 'INTERNAL_ERROR', message: 'Error del servidor.' } };
  if (datosDelError) {
    const datos = datosDelError.safeParse((body as { data?: unknown } | null)?.data);
    if (datos.success) salida.data = datos.data;
  }
  return { status, body: salida };
}
